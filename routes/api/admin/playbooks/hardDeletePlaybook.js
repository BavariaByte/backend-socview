import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";

/**
 * DELETE /api/admin/playbooks/:id/permanent
 *
 * Super admin only. Irreversibly removes a trashed playbook before the
 * retention period expires. Its version snapshots are kept so tickets
 * created from it keep rendering their historical questions.
 */
const hardDeletePlaybook = async (req, res) => {
    try {
        const { id } = req.params;
        const playbook = await Playbook.findOne({ playbookId: id });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }
        if (!playbook.deletedAt) {
            return res.status(409).json({ error: "Playbook must be in the trash before permanent deletion" });
        }

        // Only the playbook itself goes. Its PlaybookVersion documents stay:
        // tickets created from this playbook still render their historical
        // questions from those snapshots, and that has to keep working after
        // the playbook has stopped existing as a playbook.
        await Playbook.deleteOne({ playbookId: id });

        logger.info(`[hardDeletePlaybook] Permanently deleted playbook ${id} (versions kept for existing tickets)`);
        res.json({ message: "Playbook permanently deleted", playbookId: id });
    } catch (error) {
        logger.error({ err: error }, "[hardDeletePlaybook] Error");
        res.status(500).json({ error: "Failed to permanently delete playbook" });
    }
};

export default hardDeletePlaybook;
