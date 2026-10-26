import { logger } from "../../../../lib/logger.js";
import { Settings } from "@girp/database-models";

const VALID_KEYS = [
    "entra_socviewer_group",
    "entra_admin_group",
    "entra_playbook_manager_group",
    "authorized_emails",
    "admin_emails",
    "playbook_manager_emails"
];

/**
 * PATCH /api/admin/settings
 * Updates settings
 */
const updateSettings = async (req, res) => {
    try {
        const updates = req.body;

        if (!updates || typeof updates !== "object") {
            return res.status(400).json({ error: "Updates must be an object" });
        }

        const results = {};
        const errors = [];

        for (const [key, value] of Object.entries(updates)) {
            // Validate key
            if (!VALID_KEYS.includes(key)) {
                errors.push(`Unknown key: ${key}`);
                continue;
            }

            // Validate value based on the key
            if (key.startsWith("entra_")) {
                // Entra groups: should be a UUID
                if (typeof value !== "string") {
                    errors.push(`${key} must be a string`);
                    continue;
                }
            } else if (key.endsWith("_emails")) {
                // Email lists: should be an array
                if (!Array.isArray(value)) {
                    errors.push(`${key} must be an array`);
                    continue;
                }
                // Validate email format (basic check)
                const invalidEmails = value.filter(e => !e.includes("@"));
                if (invalidEmails.length > 0) {
                    errors.push(`Invalid emails in ${key}: ${invalidEmails.join(", ")}`);
                    continue;
                }
            }

            // Upsert
            await Settings.findOneAndUpdate(
                { key },
                { key, value },
                { upsert: true, new: true }
            );

            results[key] = value;
        }

        if (errors.length > 0 && Object.keys(results).length === 0) {
            return res.status(400).json({ errors });
        }

        logger.info({ updatedKeys: Object.keys(results) }, "[updateSettings] Updated");

        res.json({
            message: "Settings updated",
            updated: results,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        logger.error({ err: error }, "[updateSettings] Error");
        res.status(500).json({ error: "Failed to update settings" });
    }
};

export default updateSettings;
