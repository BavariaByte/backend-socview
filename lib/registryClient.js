import { logger } from './logger.js';

/**
 * Minimal read-only Docker Registry v2 client.
 *
 * Only needs anonymous pull access and only reads what the update check
 * requires: the OCI label org.opencontainers.image.version of a tag's amd64
 * image config. Never throws — every failure resolves to null so a broken or
 * unreachable registry can never take the platform down.
 */

const ACCEPT = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

const VERSION_LABEL = 'org.opencontainers.image.version';
const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*(:\d{1,5})?$/i;
// Each '/'-separated path segment must start with an alphanumeric and may
// only contain '.', '_', '-' between alphanumeric runs — this rejects '..'
// segments (and any other segment that isn't alphanumeric-led), closing off
// path traversal like "a/../../secret" while still accepting names such as
// "backend-socview", "girp/backend-socview" and "my.image_name-1".
const IMAGE_SEGMENT_PATTERN = '[a-z0-9]+(?:[._-][a-z0-9]+)*';
const IMAGE_PATTERN = new RegExp(`^${IMAGE_SEGMENT_PATTERN}(?:/${IMAGE_SEGMENT_PATTERN})*$`);
const REFERENCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;

export async function fetchImageVersionLabel(registry, image, tag = 'latest', { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!HOST_PATTERN.test(String(registry || '')) ||
        !IMAGE_PATTERN.test(String(image || '')) ||
        !REFERENCE_PATTERN.test(String(tag || ''))) {
        logger.warn({ registry, image, tag }, '[registryClient] Refusing malformed registry coordinates');
        return null;
    }

    const base = `https://${registry}/v2/${image}`;
    const context = { base, image, fetchImpl, token: null, timeoutMs };

    try {
        const index = await getJson(context, `${base}/manifests/${tag}`);
        if (!index) return null;

        const manifest = Array.isArray(index.manifests)
            ? await resolvePlatformManifest(context, index)
            : index;
        if (!manifest?.config?.digest) return null;

        const config = await getJson(context, `${base}/blobs/${manifest.config.digest}`);
        const label = config?.config?.Labels?.[VERSION_LABEL];
        return typeof label === 'string' && label.trim() ? label.trim() : null;
    } catch (err) {
        logger.warn({ err, registry, image }, '[registryClient] Version lookup failed');
        return null;
    }
}

/** Picks the linux/amd64 entry of an index and loads its manifest. */
async function resolvePlatformManifest(context, index) {
    const entry = index.manifests.find(m =>
        m?.platform?.architecture === 'amd64' && m?.platform?.os === 'linux')
        || index.manifests.find(m => m?.platform?.architecture && m.platform.architecture !== 'unknown');
    if (!entry?.digest) return null;
    return getJson(context, `${context.base}/manifests/${entry.digest}`);
}

/**
 * GET + JSON parse with a single anonymous-token retry on 401.
 */
async function getJson(context, url, isRetry = false) {
    const response = await request(context, url, { headers: { Accept: ACCEPT } });
    if (!response) return null;

    if (response.status === 401 && !isRetry) {
        const challenge = response.headers.get('www-authenticate');
        const token = await requestAnonymousToken(context, challenge);
        if (!token) return null;
        context.token = token;
        return getJson(context, url, true);
    }

    if (!response.ok) {
        logger.debug({ url, status: response.status }, '[registryClient] Unexpected registry status');
        return null;
    }

    return readJsonBody(url, response);
}

/**
 * GET through a timeout-bounded AbortController. Adds the bearer token from
 * context unless `useAuth` is false — the anonymous token endpoint itself
 * must never receive an Authorization header. The timeout is taken from
 * `context.timeoutMs` so every request made on behalf of a single
 * fetchImageVersionLabel call — manifests, blobs and the token request
 * alike — honours the same (overridable) bound.
 */
async function request(context, url, { headers = {}, useAuth = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs);
    try {
        const reqHeaders = { ...headers };
        if (useAuth && context.token) reqHeaders.Authorization = `Bearer ${context.token}`;
        return await context.fetchImpl(url, { headers: reqHeaders, redirect: 'follow', signal: controller.signal });
    } catch (err) {
        logger.debug({ err, url }, '[registryClient] Request failed');
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** Reads a response body with the size cap applied, then parses it as JSON. */
async function readJsonBody(url, response) {
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) {
        logger.warn({ url, size: body.length }, '[registryClient] Response too large — ignoring');
        return null;
    }
    try {
        return JSON.parse(body);
    } catch {
        logger.debug({ url }, '[registryClient] Response was not valid JSON');
        return null;
    }
}

/** Parses the Bearer challenge and fetches a pull-scoped anonymous token. */
async function requestAnonymousToken(context, challenge) {
    if (!challenge || !/^Bearer /i.test(challenge)) return null;
    const realm = /realm="([^"]+)"/i.exec(challenge)?.[1];
    const service = /service="([^"]+)"/i.exec(challenge)?.[1];
    if (!realm || !realm.startsWith('https://')) return null;

    const url = new URL(realm);
    if (service) url.searchParams.set('service', service);
    url.searchParams.set('scope', `repository:${context.image}:pull`);

    const response = await request(context, url.toString(), { headers: { Accept: 'application/json' }, useAuth: false });
    if (!response?.ok) return null;

    const body = await readJsonBody(url.toString(), response);
    return body?.token || body?.access_token || null;
}
