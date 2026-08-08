import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";

/**
 * POST /api/admin/playbooks/:id/restore
 * Moves a playbook back out of the trash.
 */
const restorePlaybook = async (req, res) => {
    try {
        const { id } = req.params;
        const playbook = await Playbook.findOne({ playbookId: id });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }
        if (!playbook.deletedAt) {
            return res.status(409).json({ error: "Playbook is not in the trash" });
        }

        playbook.deletedAt = null;
        playbook.deletedBy = null;
        await playbook.save();

        logger.info(`[restorePlaybook] Restored playbook: ${id}`);
        res.json({ message: "Playbook restored", playbookId: id });
    } catch (error) {
        logger.error({ err: error }, "[restorePlaybook] Error");
        res.status(500).json({ error: "Failed to restore playbook" });
    }
};

export default restorePlaybook;
