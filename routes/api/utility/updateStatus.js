import { logger } from "../../../lib/logger.js";
import { compareSemver } from "../../../lib/semver.js";
import { getUpdateConfig, readUpdateState, UPDATE_COMMANDS } from "../../../services/updateChecker.js";

/**
 * Shared response shape for GET /api/update-status and
 * POST /api/admin/update-check.
 */
export function buildUpdateResponse(state, config) {
    const latestVersion = state?.latestVersion || null;
    // The live version wins over the stored one: right after an upgrade the
    // state document still carries the version the previous container wrote,
    // which would tell the admin to install what they just installed.
    const currentVersion = config.currentVersion || state?.currentVersion || null;

    return {
        enabled: config.enabled,
        updateAvailable: Boolean(latestVersion && currentVersion && compareSemver(latestVersion, currentVersion) > 0),
        currentVersion,
        latestVersion,
        checkedAt: state?.checkedAt || null,
        // Lets the UI tell "checked, nothing newer" apart from "checked, but
        // no image carried a version label" — both leave latestVersion null.
        labelsFound: state?.labelsFound ?? null,
        lastError: state?.lastError || null,
        docsUrl: config.docsUrl,
        commands: UPDATE_COMMANDS
    };
}

/**
 * GET /api/update-status
 * Returns the cached result of the last registry update check.
 */
export default async function updateStatus(req, res) {
    try {
        const config = getUpdateConfig();
        const state = await readUpdateState();
        res.json(buildUpdateResponse(state, config));
    } catch (error) {
        logger.error({ err: error }, "[GET /api/update-status]");
        res.status(500).json({ error: "Unable to read update status" });
    }
}
