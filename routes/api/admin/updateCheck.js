import { logger } from "../../../lib/logger.js";
import { checkForUpdates, getUpdateConfig } from "../../../services/updateChecker.js";
import { buildUpdateResponse } from "../utility/updateStatus.js";

// Process-wide throttle: the registry must not be hammered from the UI.
const MIN_INTERVAL_MS = 60_000;
let lastManualCheck = 0;

/**
 * POST /api/admin/update-check
 * Runs the registry check immediately ("check now" button).
 */
export default async function updateCheck(req, res) {
    try {
        const config = getUpdateConfig();
        if (!config.enabled) {
            return res.status(409).json({ error: "Update check is disabled" });
        }

        const elapsed = Date.now() - lastManualCheck;
        if (elapsed < MIN_INTERVAL_MS) {
            return res.status(429).json({
                error: "Update check was run a moment ago",
                retryAfterSeconds: Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000)
            });
        }
        lastManualCheck = Date.now();

        const state = await checkForUpdates();
        res.json(buildUpdateResponse(state, config));
    } catch (error) {
        logger.error({ err: error }, "[POST /api/admin/update-check]");
        res.status(500).json({ error: "Update check failed" });
    }
}
