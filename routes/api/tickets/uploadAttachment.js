/**
 * POST /api/tickets/:id/attachments
 *
 * Path parameters:
 *   - id (string, required): Ticket MongoID or ticket_id
 *
 * Form-data:
 *   - file (binary, required)
 *   - description (string, optional)
 */
export default async function uploadTicketAttachment(req, res) {
  res.status(501).json({ error: "Ticket attachments are not implemented yet" });
}
