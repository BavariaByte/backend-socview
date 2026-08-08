import { logger } from "../../../lib/logger.js";
import { findTicketByIdentifier, mapTicket } from "./utils.js";

/**
 * POST /api/tickets/:id/restore
 *
 * Admin only. Restores a soft-deleted ticket by clearing deletedAt and deletedBy.
 */
export default async function restoreTicket(req, res) {
  try {
    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (!ticket.deletedAt) {
      return res.status(409).json({ error: "Ticket is not deleted" });
    }

    ticket.deletedAt = null;
    ticket.deletedBy = null;
    await ticket.save();

    res.json(mapTicket(ticket));
  } catch (error) {
    logger.error({ err: error }, "[POST /api/tickets/:id/restore]");
    res.status(500).json({ error: "Unable to restore ticket" });
  }
}
