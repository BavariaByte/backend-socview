import { logger } from "../../../lib/logger.js";
import { PlaybookVersion } from "@girp/database-models";

/**
 * GET /api/playbooks/:playbookId/versions/:version
 * Fetches a specific version of a playbook
 *
 * Used by the SocViewer to load historical questions for old tickets
 */
const getPlaybookVersion = async (req, res) => {
    try {
        const { playbookId, version } = req.params;
        const versionNum = parseInt(version, 10);

        if (isNaN(versionNum) || versionNum < 1) {
            return res.status(400).json({ error: "Version must be a positive number" });
        }

        const playbookVersion = await PlaybookVersion.getVersion(playbookId, versionNum);

        if (!playbookVersion) {
            return res.status(404).json({
                error: "Playbook version not found",
                playbookId,
                version: versionNum
            });
        }

        res.json({
            playbookId: playbookVersion.playbookId,
            version: playbookVersion.version,
            name: playbookVersion.name,
            definition: playbookVersion.definition,
            createdAt: playbookVersion.createdAt
        });

    } catch (error) {
        logger.error({ err: error }, "[getPlaybookVersion] Error");
        res.status(500).json({ error: "Failed to fetch playbook version" });
    }
};

export default getPlaybookVersion;
