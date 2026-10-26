import { logger } from "../../../lib/logger.js";
import { FormResult } from "@girp/database-models";
import { mapFormResult } from "./utils.js";
import { stripMongoOperators } from "../middleware/sanitize.js";

/**
 * PATCH /api/forms/:formId/results/:resultId
 *
 * Body parameters (optional, at least one required):
 *   - meta (object)
 */
export default async function updateFormResult(req, res) {
  try {
    if (req.body && typeof req.body === "object") {
      stripMongoOperators(req.body);
    }

    const updates = {};
    if (req.body?.meta !== undefined) {
      if (typeof req.body.meta !== "object" || req.body.meta === null || Array.isArray(req.body.meta)) {
        return res.status(400).json({ error: "meta must be an object" });
      }
      updates.meta = req.body.meta;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "At least one updatable field must be provided" });
    }

    const result = await FormResult.findOneAndUpdate(
      { _id: req.params.resultId, formKey: req.params.formId },
      { $set: updates },
      { new: true },
    );

    if (!result) {
      return res.status(404).json({ error: "Form result not found" });
    }

    res.json(mapFormResult(result));
  } catch (error) {
    logger.error({ err: error }, "[PATCH /api/forms/:formId/results/:resultId]");
    res.status(500).json({ error: "Unable to update form result" });
  }
}
