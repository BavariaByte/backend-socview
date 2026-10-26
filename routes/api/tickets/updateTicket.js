import { logger } from "../../../lib/logger.js";
import mongoose from "mongoose";
import { TicketModel, FormResult } from "@girp/database-models";
import { mapTicket, findTicketByIdentifier, parseDateInput, TICKET_STATES } from "./utils.js";
import { stripMongoOperators, sanitizeString, isValidObjectId } from "../middleware/sanitize.js";

// Fix reference mismatch: TicketModel expects 'FormResult', but model is named 'form_results'
if (!mongoose.models.FormResult && FormResult && FormResult.schema) {
  mongoose.model('FormResult', FormResult.schema, 'form_results');
}

/**
 * PATCH /api/tickets/:id
 *
 * Path parameters:
 *   - id (string, required): MongoID or ticket_id
 *
 * Body parameters (optional, at least one required):
 *   - ticket_subject (string)
 *   - project_id (string)
 *   - assigned_member (string)
 *   - state (string)
 *   - deferred_date (string, ISO)
 *   - formResult (string)
 */
export default async function updateTicket(req, res) {
  try {
    // Defense-in-depth: drop any NoSQL operators ($ne, $gt, …) the client may have injected.
    if (req.body && typeof req.body === "object") {
      stripMongoOperators(req.body);
    }

    const ticket = await findTicketByIdentifier(req.params?.id);
    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const {
      ticket_subject,
      project_id,
      assigned_member,
      state,
      deferred_date,
      formResult,
      severity,
    } = req.body || {};

    const updates = {};

    if (ticket_subject !== undefined) {
      const cleanSubject = sanitizeString(ticket_subject);
      if (!cleanSubject) {
        return res.status(400).json({ error: "ticket_subject must be a non-empty string" });
      }
      updates.ticket_subject = cleanSubject;
    }

    if (project_id !== undefined) {
      if (project_id !== null && typeof project_id !== "string") {
        return res.status(400).json({ error: "project_id must be a string or null" });
      }
      updates.project_id = project_id;
    }

    if (assigned_member !== undefined) {
      if (assigned_member === "" || assigned_member === null) {
        updates.assigned_member = null;
      } else if (typeof assigned_member !== "string" || !isValidObjectId(assigned_member)) {
        return res.status(400).json({ error: "assigned_member must be a valid ObjectId" });
      } else {
        updates.assigned_member = assigned_member;
      }
    }

    if (state !== undefined) {
      if (typeof state !== "string" || !TICKET_STATES.includes(state)) {
        return res.status(400).json({
          error: `state must be one of: ${TICKET_STATES.join(", ")}`,
        });
      }
      updates.state = state;
    }

    if (deferred_date !== undefined) {
      if (deferred_date === null || deferred_date === "") {
        updates.deferred_date = null;
      } else {
        const parsed = parseDateInput(deferred_date);
        if (!parsed) {
          return res.status(400).json({ error: "deferred_date must be a valid ISO date" });
        }
        updates.deferred_date = parsed;
      }
    }

    if (severity !== undefined) {
      if (typeof severity !== "string" || severity.length === 0 || severity.length > 32) {
        return res.status(400).json({ error: "severity must be a non-empty string (≤32 chars)" });
      }
      updates.severity = severity;
    }
    if (formResult !== undefined) {
      if (typeof formResult === 'object' && formResult !== null) {
        // It's an object, so we update the LINKED FormResult document
        // Check if ticket has a formResult linked
        const formResultId = ticket.formResult?._id || ticket.formResult;

        if (formResultId) {
          logger.info({ formResultId }, '[updateTicket] Updating linked FormResult');

          // 1. Fetch current FormResult to diff answers
          const currentFormResult = await FormResult.findById(formResultId).lean();
          const oldAnswers = currentFormResult?.answers || [];
          const newAnswers = formResult.answers || [];

          // 2. Calculate Diffs for Changelog
          const changes = [];
          const userId = req.sessionUser?._id || null;

          if (Array.isArray(newAnswers)) {
            // Map old answers by 'q' for easy lookup
            const oldMap = new Map((oldAnswers).map(a => [a.q, a]));

            for (const newAns of newAnswers) {
              const oldAns = oldMap.get(newAns.q);
              const qId = newAns.q;

              // Normalize values for comparison
              const normalize = (v) => {
                if (v === undefined || v === null) return '';
                return JSON.stringify(v);
              }

              const newVal = newAns.value;
              const oldVal = oldAns?.value;

              if (!oldAns) {
                // New answer (unlikely in this context, but possible)
                changes.push({
                  action: 'new',
                  changed_field: 'formResult.answers',
                  changed_question: qId,
                  new_value: newVal,
                  user: userId
                });
              } else if (normalize(newVal) !== normalize(oldVal)) {
                // Update
                changes.push({
                  action: 'update',
                  changed_field: 'formResult.answers',
                  changed_question: qId,
                  old_value: oldVal,
                  new_value: newVal,
                  user: userId
                });
              }
            }
          }

          // 3. Push changes to ticket.changelog
          if (changes.length > 0) {
            logger.info(`[updateTicket] Generated ${changes.length} changelog entries for answers.`);
            ticket.changelog.push(...changes);
          }

          // SECURITY: Whitelist — only `answers` is editable through this endpoint.
          // Fields like `actor`, `playbookId`, `playbookVersion`, `meta`, `endScore`,
          // `submittedAt`, `scoreMeta` MUST NOT be re-writable from a ticket-edit body.
          if (Array.isArray(newAnswers)) {
            await FormResult.findByIdAndUpdate(formResultId, {
              $set: { answers: newAnswers },
            });
          } else {
            logger.warn('[updateTicket] formResult update ignored: answers missing or not an array');
          }
        } else {
          logger.warn('[updateTicket] Received formResult object but ticket has no linked formResult.');
        }
        // Do NOT add to ticket 'updates' as we handled it separately
      } else {
        // It's likely an ID string, so we update the reference on the ticket
        updates.formResult = formResult;
      }
    }

    // Check if we have any ticket-level updates
    if (!Object.keys(updates).length && typeof formResult !== 'object') {
      return res.status(400).json({ error: "At least one updatable field must be provided" });
    }

    Object.assign(ticket, updates);

    // Initialize $locals if needed and set userId for changelog tracking
    if (!ticket.$locals) ticket.$locals = {};
    if (req.sessionUser?._id) {
      ticket.$locals.userId = req.sessionUser._id;
    }

    logger.info({ updatedFields: Object.keys(updates), userId: ticket.$locals?.userId }, '[updateTicket] Saving ticket with updates');
    await ticket.save();
    logger.info({ changelogEntries: ticket.changelog?.length }, '[updateTicket] Ticket saved');

    const fresh = await TicketModel.findById(ticket._id).populate('formResult');
    res.json(mapTicket(fresh));
  } catch (error) {
    logger.error({ err: error }, "[PATCH /api/tickets/:id]");
    res.status(500).json({ error: "Unable to update ticket" });
  }
}
