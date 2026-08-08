import { logger } from "../../../lib/logger.js";
import { FormResult } from "@girp/database-models";
import { parsePagination, parseDateInput, mapFormResult } from "./utils.js";

/**
 * GET /api/forms/:formId/results
 *
 * Path parameters:
 *   - formId (string, required): Form key
 *
 * Query parameters:
 *   - limit (number, optional)
 *   - offset (number, optional)
 *   - submittedFrom (string, optional): ISO timestamp as lower bound
 *   - submittedTo (string, optional): ISO timestamp as upper bound
 *   - actorUserId (string, optional): Filter auf actor.userId
 */
export default async function listFormResults(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const filter = { formKey: req.params.formId };

    const submittedFrom = parseDateInput(req.query?.submittedFrom);
    const submittedTo = parseDateInput(req.query?.submittedTo);
    if (req.query?.submittedFrom && !submittedFrom) {
      return res.status(400).json({ error: "submittedFrom must be a valid ISO date" });
    }
    if (req.query?.submittedTo && !submittedTo) {
      return res.status(400).json({ error: "submittedTo must be a valid ISO date" });
    }
    if (submittedFrom || submittedTo) {
      filter.submittedAt = {};
      if (submittedFrom) filter.submittedAt.$gte = submittedFrom;
      if (submittedTo) filter.submittedAt.$lte = submittedTo;
    }

    if (req.query?.actorUserId) {
      if (typeof req.query.actorUserId !== 'string') {
        return res.status(400).json({ error: "Invalid actorUserId filter" });
      }
      filter["actor.userId"] = req.query.actorUserId;
    }

    const [total, results] = await Promise.all([
      FormResult.countDocuments(filter),
      FormResult.find(filter)
        .skip(offset)
        .limit(limit)
        .sort({ submittedAt: -1 }),
    ]);

    res.json({
      data: results.map(mapFormResult),
      pagination: { total, limit, offset },
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/forms/:formId/results]");
    res.status(500).json({ error: "Unable to list form results" });
  }
}
