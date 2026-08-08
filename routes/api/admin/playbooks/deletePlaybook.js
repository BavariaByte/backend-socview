import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";


/**
 * DELETE /api/admin/playbooks/:id
 * Moves a playbook to the trash (soft delete). Versions are kept so a
 * restore is complete; permanent removal happens after TICKET_RETENTION_DAYS
 * or earlier via a super admin.
 */
const deletePlaybook = async (req, res) => {
    try {
        const { id } = req.params;

        const playbook = await Playbook.findOne({ playbookId: id, deletedAt: null });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }

        // Soft delete — the playbook moves to the trash and is permanently
        // removed after TICKET_RETENTION_DAYS (or earlier by a super admin).
        playbook.deletedAt = new Date();
        playbook.deletedBy = req.sessionUser?.userid || req.sessionUser?._id?.toString() || "unknown";
        await playbook.save();

        logger.info(`[deletePlaybook] Moved playbook to trash: ${id}`);

        res.json({
            message: "Playbook moved to trash",
            playbookId: id
        });

    } catch (error) {
        logger.error({ err: error }, "[deletePlaybook] Error");
        res.status(500).json({ error: "Failed to delete playbook" });
    }
};

export default deletePlaybook;
