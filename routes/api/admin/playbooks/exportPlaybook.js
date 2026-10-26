import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";
import { PlaybookVersion } from "@girp/database-models";


/**
 * GET /api/admin/playbooks/:id/export
 * Exports the JSON definition of a playbook
 */
const PLAYBOOK_ID_PATTERN = /^[a-z0-9-]+$/;

const exportPlaybook = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate id strictly before using it in DB lookups OR in the
        // Content-Disposition header (HTTP-Header-Injection / filename smuggling).
        if (typeof id !== "string" || !PLAYBOOK_ID_PATTERN.test(id)) {
            return res.status(400).json({ error: "Invalid playbook ID" });
        }

        // Check that the playbook exists in the DB
        const playbook = await Playbook.findOne({ playbookId: id, deletedAt: null });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }

        // Load the JSON definition from the database
        try {
            const versionData = await PlaybookVersion.findOne({ playbookId: id }).sort({ version: -1 }).lean();

            if (!versionData || !versionData.definition) {
                return res.status(404).json({
                    error: "JSON definition not found",
                    hint: "The playbook exists in the DB, but the JSON definition is missing"
                });
            }

            const formDefinition = versionData.definition;

            // Set the Content-Disposition header for download
            res.setHeader("Content-Disposition", `attachment; filename="${id}.json"`);
            res.setHeader("Content-Type", "application/json");
            res.json(formDefinition);

        } catch (err) {
            logger.warn({ err }, `[exportPlaybook] Failed fetching JSON for ${id}`);
            return res.status(500).json({
                error: "Failed to read JSON definition",
                hint: "Database error while fetching the playbook definition"
            });
        }

    } catch (error) {
        logger.error({ err: error }, "[exportPlaybook] Error");
        res.status(500).json({ error: "Failed to export playbook" });
    }
};

export default exportPlaybook;
