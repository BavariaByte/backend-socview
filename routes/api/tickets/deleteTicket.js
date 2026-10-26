import { logger } from "../../../lib/logger.js";
import { findTicketByIdentifier } from "./utils.js";

/**
 * DELETE /api/tickets/:id
 *
 * Soft-deletes a ticket by setting deletedAt and deletedBy.
 * Requires TICKET_DELETE scope (admin only).
 * The ticket remains in the database and can be restored by an admin.
 * Permanent deletion happens automatically after TICKET_RETENTION_DAYS.
 */
export default async function deleteTicket(req, res) {
  try {
    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (ticket.deletedAt) {
      return res.status(409).json({ error: "Ticket is already deleted" });
    }

    const userId = req.sessionUser?.userid || req.sessionUser?._id?.toString()
      || req.user?.id || req.user?.userid || req.user?.oid || "unknown";

    ticket.deletedAt = new Date();
    ticket.deletedBy = userId;
    await ticket.save();

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "[DELETE /api/tickets/:id]");
    res.status(500).json({ error: "Unable to delete ticket" });
  }
}
