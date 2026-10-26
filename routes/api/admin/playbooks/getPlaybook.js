import { logger } from "../../../../lib/logger.js";
import { Playbook } from "@girp/database-models";
import { PlaybookVersion } from "@girp/database-models";


/**
 * GET /api/admin/playbooks/:id
 * Fetches a single playbook including its JSON definition
 */
const getPlaybook = async (req, res) => {
    try {
        const { id } = req.params;

        const playbook = await Playbook.findOne({ playbookId: id, deletedAt: null });
        if (!playbook) {
            return res.status(404).json({ error: "Playbook not found" });
        }

        // Try to load the JSON definition from the database
        let formDefinition = null;
        try {
            const versionData = await PlaybookVersion.findOne({ playbookId: id }).sort({ version: -1 }).lean();
            if (versionData && versionData.definition) {
                formDefinition = versionData.definition;
            }
        } catch (err) {
            logger.warn({ err }, `[getPlaybook] Could not load JSON for ${id} from DB`);
        }

        res.json({
            playbook: {
                playbookId: playbook.playbookId,
                name: playbook.name,
                status: playbook.status,
                createdAt: playbook.createdAt,
                updatedAt: playbook.updatedAt
            },
            formDefinition
        });

    } catch (error) {
        logger.error({ err: error }, "[getPlaybook] Error");
        res.status(500).json({ error: "Failed to load playbook" });
    }
};

export default getPlaybook;
