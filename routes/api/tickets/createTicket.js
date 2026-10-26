import { logger } from "../../../lib/logger.js";
import { TicketModel, CounterModel } from "@girp/database-models";
import { mapTicket, parseDateInput } from "./utils.js";
import { sanitizeString, stripMongoOperators } from "../middleware/sanitize.js";
import { notifyNewTicket } from "../../../services/notificationService.js";
import { isTicketWatcherActive } from "../../../services/ticketWatcher.js";

/**
 * POST /api/tickets
 *
 * Body parameters:
 *   - ticket_subject (string, required): Kurzer Titel/Beschreibung.
 *   - project_id (string, optional): Associated project.
 *   - formResult (string, optional): ObjectId of a form result.
 *   - assigned_member (string, optional): ObjectId of a SOC member.
 *   - state (string, optional): Ticketstatus (Default: open).
 *   - deferred_date (string, optional): ISO date if the ticket was deferred.
 *   - comments (array, optional): Initiale Kommentare (Objekte mit comment_content, author).
 *
 * Request example:
 * {
 *   "ticket_subject": "Strange network activity",
 *   "project_id": "BREACH",
 *   "assigned_member": "6512f5f4e1f1a0c123456789"
 * }
 */
export default async function createTicket(req, res) {
  try {
    // Sanitize request body against NoSQL injection
    if (req.body && typeof req.body === 'object') {
      stripMongoOperators(req.body);
    }

    const {
      project_id,
      formResult,
      assigned_member,
      state,
      deferred_date,
      comments,
    } = req.body || {};

    // Sanitize ticket subject (strip HTML, null bytes, enforce length)
    const ticket_subject = sanitizeString(req.body?.ticket_subject);
    if (!ticket_subject) {
      return res.status(400).json({ error: "ticket_subject is required" });
    }

    let parsedDeferred = null;
    if (deferred_date !== undefined) {
      parsedDeferred = parseDateInput(deferred_date);
      if (!parsedDeferred) {
        return res.status(400).json({ error: "deferred_date must be a valid ISO date" });
      }
    }

    // Author of any initial comment is ALWAYS the session user — body 'author' is ignored.
    const sessionAuthorId = req.sessionUser?._id;
    const normalizedComments = Array.isArray(comments)
      ? comments
        .filter((c) => c && typeof c.comment_content === "string" && c.comment_content.trim().length)
        .map((c) => ({
          comment_content: sanitizeString(c.comment_content),
          author: sessionAuthorId,
        }))
      : [];

    const counter = await CounterModel.findOneAndUpdate(
      { name: "ticket_id" },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const created = await TicketModel.create({
      ticket_id: counter.value,
      ticket_subject,
      project_id,
      formResult,
      assigned_member,
      state: state || "open",
      deferred_date: parsedDeferred,
      comments: normalizedComments,
    });

    res.status(201).json(mapTicket(created));
    // The change stream watcher is the primary notifier (it also covers
    // tickets inserted by other services, e.g. Backend-InputForm). Only
    // notify from here when the watcher is down (no replica set / reconnect),
    // otherwise every API-created ticket would notify twice.
    if (!isTicketWatcherActive()) {
      // Fire-and-forget: do not await — never delay the HTTP response
      notifyNewTicket(mapTicket(created)).catch((err) =>
        logger.error({ err }, '[createTicket] notifyNewTicket unexpected error')
      );
    }
  } catch (error) {
    logger.error({ err: error }, "[POST /api/tickets]");
    res.status(500).json({ error: "Unable to create ticket" });
  }
}
