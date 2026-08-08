import { logger } from "../../../lib/logger.js";
import { findTicketByIdentifier } from "./utils.js";

/**
 * GET /api/tickets/:id/timeline
 *
 * Path parameters:
 *   - id (string, required): Ticket MongoID or ticket_id
 *
 * Query parameters:
 *   - order (string, optional): "asc" or "desc" (default: asc)
 *   - include (string, optional): Kommaseparierte Liste aus "comment", "change"
 */
export default async function getTicketTimeline(req, res) {
  try {
    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const order = req.query?.order === "desc" ? "desc" : "asc";
    const include = req.query?.include
      ? req.query.include.split(",").map((item) => item.trim()).filter(Boolean)
      : undefined;

    const timeline = await ticket.getTimeline({ populate: true, order, include });

    const items = timeline.map((entry) => ({
      type: entry.type,
      at: entry.at instanceof Date ? entry.at.toISOString() : entry.at,
      user: entry.user && entry.user._id ? entry.user._id.toString() : entry.user,
      data: entry.data,
    }));

    res.json(items);
  } catch (error) {
    logger.error({ err: error }, "[GET /api/tickets/:id/timeline]");
    res.status(500).json({ error: "Unable to load ticket timeline" });
  }
}
