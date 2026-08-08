import { logger } from "../../../../lib/logger.js";
import { IS_PRODUCTION } from "../../../../lib/env.js";
import { Playbook } from '@girp/database-models';
import { PlaybookVersion } from '@girp/database-models';

/**
 * POST /api/admin/playbooks
 * Creates a new playbook and the initial JSON definition
 */
const createPlaybook = async (req, res) => {
  try {
    const { playbookId, name } = req.body;

    if (!playbookId || !name) {
      return res.status(400).json({ error: 'playbookId and name are required' });
    }

    // Validate playbookId format
    if (!/^[a-z0-9-]+$/.test(playbookId)) {
      return res.status(400).json({
        error: 'playbookId may only contain lowercase letters, digits, and hyphens',
      });
    }

    // Check whether the playbookId already exists
    const existing = await Playbook.findOne({ playbookId });
    if (existing) {
      if (existing.deletedAt) {
        return res.status(409).json({
          error: 'Playbook with this ID is in the trash',
          playbookId,
          inTrash: true
        });
      }
      return res.status(409).json({ error: 'A playbook with this ID already exists' });
    }

    // Create the playbook in the DB with version 0
    const playbook = new Playbook({
      playbookId,
      name,
      status: 'draft',
      currentVersion: 0,
    });
    await playbook.save();

    // Create the initial JSON template (version 0)
    const template = {
      type: 'form-definition',
      meta: {
        id: playbookId,
        version: '0',
      },
      schemaId: `${playbookId}-v1`,
      schemaHash: '',
      i18n: {
        defaultLocale: 'de-DE',
        supported: ['de-DE'],
      },
      form: {
        title: {
          'de-DE': name,
        },
        progress: {
          mode: 'percent',
        },
        completion: {
          title: {
            'de-DE': 'Vielen Dank',
          },
          description: {
            'de-DE': 'Ihre Eingaben wurden gespeichert.',
          },
          summaryEditable: false,
        },
      },
      runtime: {
        session: {
          resume: {
            maxAgeMinutes: 120,
          },
        },
      },
      variables: [],
      calculation: {
        checkboxOptionOrder: 'definition',
        onDivZero: 'error',
        rounding: 2,
      },
      flow: {
        start: '',
        end: 'submit',
        endBehavior: {
          lockAnswers: true,
        },
      },
      questions: [],
    };

    // Save version 0 in the PlaybookVersion collection
    await PlaybookVersion.create({
      playbookId,
      version: 0,
      name,
      definition: template,
    });

    logger.info(`[createPlaybook] Created playbook: ${playbookId} (v0) in DB`);

    res.status(201).json({
      message: 'Playbook created',
      playbook: {
        playbookId: playbook.playbookId,
        name: playbook.name,
        status: playbook.status,
        createdAt: playbook.createdAt,
        currentVersion: 0,
      },
      template,
      downloadHint: 'Download the JSON file and import it in the Formbuilder.',
      formBuilderLink: `${process.env.FORMBUILDER_URL || (IS_PRODUCTION ? 'https://builder.girp.bavariabyte.com' : 'http://localhost:8080')}/import`,
    });
  } catch (error) {
    logger.error({ err: error }, '[createPlaybook] Error');

    if (error.code === 11000) {
      return res.status(409).json({ error: 'A playbook with this ID already exists' });
    }

    res.status(500).json({ error: 'Failed to create playbook' });
  }
};

export default createPlaybook;
