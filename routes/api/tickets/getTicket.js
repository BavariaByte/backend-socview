import { logger } from "../../../lib/logger.js";
import { TicketModel, PlaybookVersion, FormSession } from "@girp/database-models";
import { mapTicket, findTicketByIdentifier } from "./utils.js";

/**
 * GET /api/tickets/:id
 *
 * Path parameters:
 *   - id (string, required): MongoDB ObjectId or numeric ticket_id
 */
export default async function getTicket(req, res) {
  try {
    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    if (ticket.deletedAt) {
      return res.status(410).json({ error: "Ticket has been deleted", deletedAt: ticket.deletedAt });
    }

    const populated = await TicketModel.findById(ticket._id).populate([
      { path: "comments.author", model: "soc_users" },
      { path: "assigned_member", model: "soc_users" },
      { path: "formResult", model: "FormResult" },
    ]);

    const t = mapTicket(populated || ticket);

    // Resolve effective form status: "abandoned" if session expired, "in-progress" if still active
    if (t.formResult && t.formResult.status !== "completed") {
      const activeSession = await FormSession.findOne({
        formResultId: t.formResult.id,
        expiresAt: { $gt: new Date() },
      }).lean();
      t.formResult.status = activeSession ? "in-progress" : "abandoned";
    }

    // Embed playbook definition so frontend has labels immediately (no second API call)
    if (t.formResult?.playbookId) {
      const pbId = t.formResult.playbookId;
      const pbVer = t.formResult.playbookVersion;
      let pbDoc = null;

      // Try specific version first
      if (pbVer) {
        pbDoc = await PlaybookVersion.getVersion(pbId, pbVer);
      }
      // Fallback: latest version
      if (!pbDoc) {
        const latestNum = await PlaybookVersion.getLatestVersion(pbId);
        if (latestNum) {
          pbDoc = await PlaybookVersion.getVersion(pbId, latestNum);
        }
      }
      if (pbDoc?.definition) {
        t.playbookDefinition = pbDoc.definition;
      }
    }

    res.json(t);
  } catch (error) {
    logger.error({ err: error }, "[GET /api/tickets/:id]");
    res.status(500).json({ error: "Unable to retrieve ticket" });
  }
}
