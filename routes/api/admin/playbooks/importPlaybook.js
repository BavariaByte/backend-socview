import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";
import { PlaybookVersion } from "@girp/database-models";
import { rejectInvalidPlaybook } from "../../middleware/validatePlaybookJson.js";


/**
 * POST /api/admin/playbooks/:id/import
 * Imports a JSON definition for an existing playbook
 *
 * Version validation:
 * - meta.id must match the playbookId
 * - meta.version must be numeric and equal to the latest version + 1
 * - On success: save to PlaybookVersion + overwrite the filesystem copy
 */
const importPlaybook = async (req, res) => {
    try {
        const { id } = req.params;
        const { formDefinition } = req.body;

        if (!rejectInvalidPlaybook(formDefinition, res, "[importPlaybook]")) return;

        // Check that the playbook exists
        const playbook = await Playbook.findOne({ playbookId: id, deletedAt: null });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }

        // Extract metadata from the JSON
        const meta = formDefinition.meta;
        if (!meta) {
            return res.status(400).json({
                error: "meta object missing from JSON",
                hint: "The JSON must contain a 'meta' object with 'id', 'title', and 'version'"
            });
        }

        const jsonPlaybookId = meta.id;
        // Prioritize form.title, fall back to meta.title for backwards compatibility
        const rawTitle = formDefinition.form?.title || meta.title;
        const jsonTitle = typeof rawTitle === "string" ? rawTitle : rawTitle?.["de-DE"] || rawTitle?.["en-US"];
        const jsonVersion = parseInt(meta.version, 10);

        // Validate playbookId
        if (jsonPlaybookId !== id) {
            return res.status(400).json({
                error: `PlaybookId mismatch: JSON contains "${jsonPlaybookId}", expected "${id}"`,
                hint: "The meta.id in the JSON must match the playbookId"
            });
        }

        // Validate title
        if (!jsonTitle || typeof jsonTitle !== "string") {
            return res.status(400).json({
                error: "Title missing or invalid",
                hint: "form.title or meta.title must be a string or an i18n object"
            });
        }

        // Validate version
        if (isNaN(jsonVersion) || jsonVersion < 1) {
            return res.status(400).json({
                error: `Invalid version: "${meta.version}"`,
                hint: "meta.version must be a positive number (e.g. '1', '2', '3')"
            });
        }

        // Fetch the current highest version — auto-increment if the version already exists or is too low
        const latestVersion = await PlaybookVersion.getLatestVersion(id);
        const effectiveVersion = jsonVersion <= latestVersion ? latestVersion + 1 : jsonVersion;

        // Save the new version to the DB
        const newVersion = new PlaybookVersion({
            playbookId: id,
            version: effectiveVersion,
            name: jsonTitle,
            definition: formDefinition
        });
        await newVersion.save();



        // Update playbook metadata
        playbook.name = jsonTitle;
        playbook.updatedAt = new Date();
        playbook.currentVersion = effectiveVersion;
        await playbook.save();

        logger.info(`[importPlaybook] Imported version ${effectiveVersion} for: ${id}${effectiveVersion !== jsonVersion ? ` (auto-incremented from ${jsonVersion})` : ''}`);

        res.json({
            message: effectiveVersion !== jsonVersion
                ? `Playbook version auto-incremented to ${effectiveVersion} and imported`
                : `Playbook version ${effectiveVersion} imported successfully`,
            playbook: {
                playbookId: playbook.playbookId,
                name: playbook.name,
                status: playbook.status,
                version: effectiveVersion,
                updatedAt: playbook.updatedAt
            }
        });

    } catch (error) {
        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(400).json({
                error: "This version already exists",
                hint: "Concurrent import detected. Please reload the page."
            });
        }
        logger.error({ err: error }, "[importPlaybook] Error");
        res.status(500).json({ error: "Failed to import playbook" });
    }
};

export default importPlaybook;
