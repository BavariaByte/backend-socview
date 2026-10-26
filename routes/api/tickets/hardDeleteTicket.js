import { logger } from "../../../lib/logger.js";
import { findTicketByIdentifier } from "./utils.js";

/**
 * DELETE /api/tickets/:id/permanent
 *
 * Admin only. Permanently and irreversibly deletes a ticket from the database.
 * Ticket must be soft-deleted first.
 */
export default async function hardDeleteTicket(req, res) {
  try {
    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (!ticket.deletedAt) {
      return res.status(409).json({ error: "Ticket must be soft-deleted before permanent deletion" });
    }

    await ticket.deleteOne();
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "[DELETE /api/tickets/:id/permanent]");
    res.status(500).json({ error: "Unable to permanently delete ticket" });
  }
}
