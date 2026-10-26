import { logger } from "../../../lib/logger.js";
import { FormResult } from "@girp/database-models";
import { mapFormResult, parseDateInput } from "./utils.js";
import { stripMongoOperators } from "../middleware/sanitize.js";

/**
 * POST /api/forms/:formId/results
 *
 * Path parameters:
 *   - formId (string, required): Form key
 *
 * Body parameters:
 *   - formVersion (number, required)
 *   - answers (array, required)
 *   - formHash (string, optional)
 *   - actor (object, optional)
 *   - submittedAt (string, optional, ISO)
 *   - meta (object, optional)
 *   - playbookId (string, optional): Playbook ID for historical question mapping
 *   - playbookVersion (number, optional): Playbook version for historical question mapping
 */
export default async function createFormResult(req, res) {
  try {
    if (req.body && typeof req.body === "object") {
      stripMongoOperators(req.body);
    }

    const formKey = req.params.formId;
    const {
      formVersion,
      answers,
      formHash,
      submittedAt,
      meta,
      playbookId,
      playbookVersion,
    } = req.body || {};

    if (typeof formVersion !== "number") {
      return res.status(400).json({ error: "formVersion must be a number" });
    }
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: "answers must be a non-empty array" });
    }
    if (formHash !== undefined && typeof formHash !== "string") {
      return res.status(400).json({ error: "formHash must be a string" });
    }
    if (meta !== undefined && (typeof meta !== "object" || meta === null || Array.isArray(meta))) {
      return res.status(400).json({ error: "meta must be an object" });
    }

    let parsedSubmittedAt;
    if (submittedAt !== undefined) {
      parsedSubmittedAt = parseDateInput(submittedAt);
      if (!parsedSubmittedAt) {
        return res.status(400).json({ error: "submittedAt must be a valid ISO date" });
      }
    }

    // SECURITY: actor is ALWAYS derived from the authenticated session.
    // A body-supplied `actor` would otherwise allow audit-trail spoofing.
    const actorPayload = req.sessionUser
      ? { userId: req.sessionUser.userid, sessionId: req.sessionUser._id.toString() }
      : undefined;

    // Playbook reference for historical question mapping
    const playbookRef = {};
    if (playbookId && typeof playbookId === "string") {
      playbookRef.playbookId = playbookId;
    }
    if (playbookVersion && typeof playbookVersion === "number") {
      playbookRef.playbookVersion = playbookVersion;
    }

    const created = await FormResult.create({
      formKey,
      formVersion,
      formHash,
      endScore: 0,
      answers,
      actor: actorPayload,
      submittedAt: parsedSubmittedAt,
      meta,
      ...playbookRef,
    });

    res.status(201).json(mapFormResult(created));
  } catch (error) {
    logger.error({ err: error }, "[POST /api/forms/:formId/results]");
    res.status(500).json({ error: "Unable to create form result" });
  }
}
