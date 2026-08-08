import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";

/**
 * GET /api/admin/playbooks
 * Lists all playbooks
 */
const listPlaybooks = async (req, res) => {
    try {
        const { status } = req.query;

        const filter = { deletedAt: null };
        if (status && ["draft", "active", "inactive"].includes(status)) {
            filter.status = status;
        }

        const playbooks = await Playbook.find(filter)
            .sort({ createdAt: -1 })
            .select("playbookId name status createdAt updatedAt currentVersion");

        res.json({
            playbooks,
            total: playbooks.length
        });
    } catch (error) {
        logger.error({ err: error }, "[listPlaybooks] Error");
        res.status(500).json({ error: "Failed to load playbooks" });
    }
};

export default listPlaybooks;
