import { logger } from "../../../../lib/logger.js";
import { Settings } from "@girp/database-models";
import { AZURE_ENABLED } from "../../../../lib/auth.combined.js";

/**
 * GET /api/admin/settings
 * Fetches only the required admin settings (Entra groups + authMode).
 */
const ALLOWED_GET_KEYS = [
    "entra_socviewer_group",
    "entra_admin_group",
    "entra_playbook_manager_group",
];

const getSettings = async (req, res) => {
    try {
        const settings = await Settings.find({ key: { $in: ALLOWED_GET_KEYS } });

        const result = {};
        for (const setting of settings) {
            result[setting.key] = setting.value;
        }

        // Auth mode for the permissions UI (determines which fields are shown)
        result.authMode = AZURE_ENABLED ? "microsoft" : "betterauth";

        res.json({ settings: result });

    } catch (error) {
        logger.error({ err: error }, "[getSettings] Error");
        res.status(500).json({ error: "Failed to load settings" });
    }
};

export default getSettings;
