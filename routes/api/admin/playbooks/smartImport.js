import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";
import { PlaybookVersion } from "@girp/database-models";
import { rejectInvalidPlaybook } from "../../middleware/validatePlaybookJson.js";


/**
 * POST /api/admin/playbooks/smart-import
 * Smarter Import: Creates new or updates existing playbook based on ID and version.
 */
const smartImport = async (req, res) => {
    try {
        const { formDefinition, updateName } = req.body;

        if (!rejectInvalidPlaybook(formDefinition, res, "[smartImport]")) return;

        const meta = formDefinition.meta;
        if (!meta || !meta.id || !meta.version) {
            return res.status(400).json({
                error: "Invalid JSON",
                hint: "meta.id and meta.version are required"
            });
        }

        const playbookId = meta.id;
        const jsonVersion = parseInt(meta.version, 10);
        // Handle title: prioritize form.title, then meta.title (string or i18n)
        const rawTitle = formDefinition.form?.title || meta.title;
        const jsonTitle = typeof rawTitle === "string"
            ? rawTitle
            : (rawTitle?.["de-DE"] || rawTitle?.["en-US"] || "Untitled");

        if (isNaN(jsonVersion)) {
            return res.status(400).json({ error: "Version must be a number" });
        }

        // Check if playbook exists
        let playbook = await Playbook.findOne({ playbookId });

        if (playbook?.deletedAt) {
            return res.status(409).json({
                error: "Playbook with this ID is in the trash",
                playbookId,
                inTrash: true
            });
        }

        if (!playbook) {
            // CASE: CREATE NEW
            // Safety check: check regex again just in case
            if (!/^[a-z0-9-]+$/.test(playbookId)) {
                return res.status(400).json({ error: "Invalid playbook ID (only a-z, 0-9, -)" });
            }

            playbook = new Playbook({
                playbookId,
                name: jsonTitle,
                status: "draft",
                currentVersion: jsonVersion
            });
            await playbook.save();

            // Create or Update Version (Upsert to handle potential orphaned references)
            await PlaybookVersion.findOneAndUpdate(
                { playbookId, version: jsonVersion },
                {
                    playbookId,
                    version: jsonVersion,
                    name: jsonTitle,
                    definition: formDefinition
                },
                { upsert: true, new: true }
            );
            return res.status(201).json({
                message: "Playbook created",
                playbook,
                action: "created"
            });

        } else {
            // CASE: UPDATE EXISTING

            // 1. Check Name Mismatch
            if (playbook.name !== jsonTitle && !updateName) {
                return res.status(200).json({
                    status: "confirmation_required",
                    message: "Name does not match",
                    details: {
                        type: "name_change",
                        currentName: playbook.name,
                        newName: jsonTitle
                    }
                });
            }

            // 2. Check Version — auto-increment if version already exists or is too low
            const currentMax = await PlaybookVersion.getLatestVersion(playbookId);
            const effectiveVersion = jsonVersion <= currentMax ? currentMax + 1 : jsonVersion;

            // 3. Update
            if (updateName || playbook.name !== jsonTitle) {
                playbook.name = jsonTitle;
            }
            playbook.currentVersion = effectiveVersion;
            playbook.updatedAt = new Date();
            await playbook.save();

            await PlaybookVersion.findOneAndUpdate(
                { playbookId, version: effectiveVersion },
                {
                    playbookId,
                    version: effectiveVersion,
                    name: jsonTitle,
                    definition: formDefinition
                },
                { upsert: true, new: true }
            );
            return res.status(200).json({
                message: effectiveVersion !== jsonVersion
                    ? `Playbook updated (version auto-incremented to ${effectiveVersion})`
                    : "Playbook updated",
                playbook,
                action: "updated"
            });
        }

    } catch (error) {
        logger.error({ err: error }, "[smartImport] Error");
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export default smartImport;
