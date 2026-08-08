import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Settings } from '@girp/database-models';
import { fetchImageVersionLabel } from '../lib/registryClient.js';
import { compareSemver, maxStableVersion } from '../lib/semver.js';
import { sendAdminMail } from './notifications/adminMail.js';
import { logger } from '../lib/logger.js';

/**
 * Checks the Docker registry for a newer platform release.
 *
 * The CI stamps every image with org.opencontainers.image.version; this
 * service compares that label on the published :latest manifest against the
 * version this instance is running. Works with :latest as well as pinned
 * tags, needs no Docker socket and no manual version bookkeeping.
 */

const SETTINGS_KEY = 'update_check_state';
const DEFAULT_REGISTRY = 'docker.bavariabyte.com';
const DEFAULT_IMAGES = ['backend-socview', 'frontend-socview', 'backend-inputform', 'frontend-inputform'];
const DEFAULT_DOCS_URL = 'https://docs.girp.bavariabyte.com/s/efa5a8ab-bdda-4a37-881e-a5a9738afb90/doc/installation-iSNLxkXN9r#h-dienste-aktualisieren';
const DEFAULT_INTERVAL_DAYS = 3;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 30;
const STARTUP_DELAY_MS = 2 * 60 * 1000;
// Per registry request; four of them make up one image lookup.
const REQUEST_TIMEOUT_MS = 2_500;

export const UPDATE_COMMANDS = ['docker compose pull', 'docker compose up -d'];

const emptyState = () => ({
    currentVersion: null,
    latestVersion: null,
    checkedAt: null,
    notifiedVersion: null,
    images: [],
    lastError: null
});

function readOwnVersion() {
    try {
        const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
        return JSON.parse(readFileSync(pkgPath, 'utf8')).version || null;
    } catch (err) {
        logger.warn({ err }, '[updateChecker] Could not read own package version');
        return null;
    }
}

export function getUpdateConfig(env = process.env) {
    const rawInterval = parseInt(env.UPDATE_CHECK_INTERVAL_DAYS || '', 10);
    const intervalDays = Number.isFinite(rawInterval)
        ? Math.min(Math.max(rawInterval, MIN_INTERVAL_DAYS), MAX_INTERVAL_DAYS)
        : DEFAULT_INTERVAL_DAYS;

    const images = (env.UPDATE_CHECK_IMAGES || '')
        .split(',').map(s => s.trim()).filter(Boolean);

    return {
        enabled: String(env.UPDATE_CHECK_ENABLED || 'true').toLowerCase() !== 'false',
        registry: env.UPDATE_CHECK_REGISTRY || DEFAULT_REGISTRY,
        images: images.length > 0 ? images : DEFAULT_IMAGES,
        tag: env.UPDATE_CHECK_TAG || 'latest',
        // Budget per registry HTTP request. Reading one image's label takes up
        // to four sequential requests (manifest, token, platform manifest,
        // config blob), so this caps a single image at ~10s — which keeps the
        // synchronous "check now" endpoint inside the frontend's request
        // timeout, since the images themselves are fetched concurrently.
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        intervalDays,
        docsUrl: env.UPDATE_DOCS_URL || DEFAULT_DOCS_URL,
        currentVersion: env.GIRP_VERSION || readOwnVersion()
    };
}

/**
 * Core routine — all collaborators injected so the tests run without
 * database, network or SMTP.
 */
export async function runUpdateCheck({
    config,
    fetchLabel,
    loadState,
    saveState,
    sendMail,
    now = () => new Date()
}) {
    const previous = (await loadState()) || emptyState();
    if (!config.enabled) return previous;

    const images = [];
    const errors = [];

    // Concurrent across images, and each individual registry request is
    // bounded by config.requestTimeoutMs, so the synchronous "check now"
    // endpoint stays inside the frontend's request timeout even when the
    // registry is slow rather than merely unreachable.
    const results = await Promise.all(config.images.map(async (image) => {
        try {
            const version = await fetchLabel(config.registry, image, config.tag, config.requestTimeoutMs);
            return { image, version: version || null };
        } catch (err) {
            return { image, version: null, error: `${image}: ${err.message}` };
        }
    }));

    for (const result of results) {
        if (result.error) errors.push(result.error);
        images.push({ image: result.image, version: result.version });
    }

    const latestVersion = maxStableVersion(images.map(i => i.version));

    // "No image carried a version label" must not look like "you are up to
    // date": both leave latestVersion null. Record it so the admin UI can say
    // the check learned nothing instead of reassuring the operator.
    const labelsFound = images.filter(i => i.version).length;
    if (labelsFound === 0 && errors.length === 0) {
        errors.push('no image carried an org.opencontainers.image.version label');
    }

    const state = {
        currentVersion: config.currentVersion,
        latestVersion,
        checkedAt: now().toISOString(),
        notifiedVersion: previous.notifiedVersion || null,
        images,
        labelsFound,
        lastError: errors.length > 0 ? errors.join('; ') : null
    };

    const updateAvailable = Boolean(
        latestVersion && config.currentVersion && compareSemver(latestVersion, config.currentVersion) > 0
    );

    if (updateAvailable && state.notifiedVersion !== latestVersion) {
        await sendMail(buildUpdateMail(config.currentVersion, latestVersion, config.docsUrl));
        state.notifiedVersion = latestVersion;
        logger.info(`[updateChecker] Notified admins about version ${latestVersion}`);
    }

    await saveState(state);
    return state;
}

export function buildUpdateMail(currentVersion, latestVersion, docsUrl) {
    const commands = UPDATE_COMMANDS.join('\n');
    return {
        de: {
            subject: `[GIRP] Update verfügbar: ${latestVersion}`,
            text: [
                `Für die GIRP-Plattform ist Version ${latestVersion} verfügbar.`,
                `Diese Instanz läuft aktuell mit Version ${currentVersion}.`,
                '',
                `Anleitung: ${docsUrl}`,
                '',
                'Kurzfassung — im Verzeichnis der docker-compose.yml ausführen:',
                commands
            ].join('\n'),
            html: `
                <h2>Update verfügbar: ${latestVersion}</h2>
                <p>Diese Instanz läuft aktuell mit Version <strong>${currentVersion}</strong>.</p>
                <p><a href="${docsUrl}">Anleitung „Dienste aktualisieren" öffnen</a></p>
                <pre>${commands}</pre>
            `
        },
        en: {
            subject: `[GIRP] Update available: ${latestVersion}`,
            text: [
                `Version ${latestVersion} of the GIRP platform is available.`,
                `This instance currently runs version ${currentVersion}.`,
                '',
                `Documentation: ${docsUrl}`,
                '',
                'Short version — run in the directory holding docker-compose.yml:',
                commands
            ].join('\n'),
            html: `
                <h2>Update available: ${latestVersion}</h2>
                <p>This instance currently runs version <strong>${currentVersion}</strong>.</p>
                <p><a href="${docsUrl}">Open the "updating services" documentation</a></p>
                <pre>${commands}</pre>
            `
        }
    };
}

export async function readUpdateState() {
    const doc = await Settings.findOne({ key: SETTINGS_KEY });
    return doc?.value || null;
}

async function writeUpdateState(state) {
    await Settings.findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { value: state, description: 'Cached result of the platform update check' } },
        { upsert: true }
    );
}

/** Production wiring of runUpdateCheck. */
export async function checkForUpdates() {
    return runUpdateCheck({
        config: getUpdateConfig(),
        fetchLabel: (registry, image, tag, timeoutMs) => fetchImageVersionLabel(registry, image, tag, { timeoutMs }),
        loadState: readUpdateState,
        saveState: writeUpdateState,
        sendMail: sendAdminMail
    });
}

export function startUpdateChecker() {
    const config = getUpdateConfig();
    if (!config.enabled) {
        logger.info('[updateChecker] Disabled via UPDATE_CHECK_ENABLED');
        return;
    }

    const run = () => checkForUpdates().catch(err =>
        logger.error({ err }, '[updateChecker] Update check failed'));

    setTimeout(run, STARTUP_DELAY_MS).unref();
    setInterval(run, config.intervalDays * 24 * 60 * 60 * 1000).unref();
    logger.info(`[updateChecker] Update check active (every ${config.intervalDays} day(s), registry ${config.registry})`);
}
