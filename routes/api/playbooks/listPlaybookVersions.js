import { logger } from "../../../lib/logger.js";
import { PlaybookVersion } from "@girp/database-models";

/**
 * GET /api/playbooks/:playbookId/versions
 * Lists all versions of a playbook
 */
const listPlaybookVersions = async (req, res) => {
    try {
        const { playbookId } = req.params;

        const versions = await PlaybookVersion.find({ playbookId })
            .select('version name createdAt')
            .sort({ version: -1 })
            .lean();

        res.json({
            playbookId,
            versions: versions.map(v => ({
                version: v.version,
                name: v.name,
                createdAt: v.createdAt
            })),
            latestVersion: versions[0]?.version || 0
        });

    } catch (error) {
        logger.error({ err: error }, "[listPlaybookVersions] Error");
        res.status(500).json({ error: "Failed to list versions" });
    }
};

export default listPlaybookVersions;
