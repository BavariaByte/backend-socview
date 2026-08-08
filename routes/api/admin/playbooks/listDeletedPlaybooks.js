import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";

/**
 * GET /api/admin/playbooks/deleted
 *
 * Lists soft-deleted playbooks still inside the retention window. Shares
 * TICKET_RETENTION_DAYS with the ticket trash so both expire alike.
 */
const listDeletedPlaybooks = async (req, res) => {
    try {
        const retentionDays = parseInt(process.env.TICKET_RETENTION_DAYS || "365", 10);
        const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const playbooks = await Playbook.find({ deletedAt: { $ne: null, $gte: retentionCutoff } })
            .sort({ deletedAt: -1 })
            .select("playbookId name status currentVersion deletedAt deletedBy createdAt");

        res.json({
            data: playbooks,
            total: playbooks.length,
            retentionDays
        });
    } catch (error) {
        logger.error({ err: error }, "[listDeletedPlaybooks] Error");
        res.status(500).json({ error: "Failed to load deleted playbooks" });
    }
};

export default listDeletedPlaybooks;
