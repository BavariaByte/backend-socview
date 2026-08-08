import { logger } from "../../../lib/logger.js";
import { findFormResultById, mapFormResult } from "./utils.js";

/**
 * GET /api/forms/:formId/results/:resultId
 *
 * Path parameters:
 *   - formId (string, required)
 *   - resultId (string, required)
 */
export default async function getFormResult(req, res) {
  try {
    const result = await findFormResultById(req.params.formId, req.params.resultId);
    if (!result) {
      return res.status(404).json({ error: "Form result not found" });
    }
    res.json(mapFormResult(result));
  } catch (error) {
    logger.error({ err: error }, "[GET /api/forms/:formId/results/:resultId]");
    res.status(500).json({ error: "Unable to retrieve form result" });
  }
}
