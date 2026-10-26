import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";

/**
 * PATCH /api/admin/playbooks/:id
 * Updates the status or name of a playbook
 */
const updatePlaybook = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name } = req.body;

        const playbook = await Playbook.findOne({ playbookId: id, deletedAt: null });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }

        // Only update allowed fields
        if (status && ["draft", "active", "inactive"].includes(status)) {
            playbook.status = status;
        }
        if (name && typeof name === "string" && name.trim()) {
            playbook.name = name.trim();
        }

        await playbook.save();

        logger.info({ status, name }, `[updatePlaybook] Updated playbook: ${id}`);

        res.json({
            message: "Playbook updated",
            playbook: {
                playbookId: playbook.playbookId,
                name: playbook.name,
                status: playbook.status,
                updatedAt: playbook.updatedAt
            }
        });

    } catch (error) {
        logger.error({ err: error }, "[updatePlaybook] Error");
        res.status(500).json({ error: "Failed to update playbook" });
    }
};

export default updatePlaybook;
