import { logger } from "../../../lib/logger.js";
import { TicketModel } from "@girp/database-models";
import { mapTicket, parsePagination } from "./utils.js";

/**
 * GET /api/tickets/deleted
 *
 * Admin only. Lists all soft-deleted tickets that are still within the
 * retention period (TICKET_RETENTION_DAYS env var, default 365).
 */
export default async function listDeletedTickets(req, res) {
  try {
    const retentionDays = parseInt(process.env.TICKET_RETENTION_DAYS || "365", 10);
    const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const { limit, offset } = parsePagination(req.query);

    const filter = {
      deletedAt: { $ne: null, $gte: retentionCutoff }
    };

    const [total, tickets] = await Promise.all([
      TicketModel.countDocuments(filter),
      TicketModel.find(filter)
        .skip(offset)
        .limit(limit)
        .sort({ deletedAt: -1 })
    ]);

    res.json({
      data: tickets.map(mapTicket),
      pagination: { total, limit, offset },
      retentionDays,
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/tickets/deleted]");
    res.status(500).json({ error: "Unable to list deleted tickets" });
  }
}
