import mongoose from "mongoose";
import { TicketModel } from "@girp/database-models";

export const TICKET_STATES = [
  "open",
  "investigation",
  "mitigation",
  "escalated",
  "closed",
  "deferred",
];

export function parsePagination(query = {}) {
  const MAX_LIMIT = 200;
  const limitRaw = Number.parseInt(query.limit, 10);
  const offsetRaw = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : 25;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  return { limit, offset };
}

export function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const normalizeDate = (d) => (d instanceof Date ? d.toISOString() : d);

const mapUserRef = (value) => {
  if (!value) return undefined;
  if (typeof value === "object" && value._id) {
    return {
      id: value._id.toString(),
      userid: value.userid,
      username: value.username,
      e_mail: value.e_mail,
    };
  }
  return value.toString();
};

const mapFormResultRef = (value) => {
  if (!value) return undefined;
  if (typeof value === "object" && value._id) {
    const plain = value.toObject && typeof value.toObject === 'function'
      ? value.toObject({ depopulate: false })
      : value;
    return {
      id: plain._id ? plain._id.toString() : undefined,
      formKey: plain.formKey,
      formVersion: plain.formVersion,
      formHash: plain.formHash,
      answers: plain.answers,
      actor: plain.actor,
      status: plain.scoreMeta?.status || plain.status || null,
      variablesSnapshot: plain.scoreMeta?.variablesSnapshot || null,
      submittedAt: normalizeDate(plain.submittedAt),
      meta: plain.meta,
      // Expose playbookId + playbookVersion at top level for ticket.vue loadPlaybookQuestions
      playbookId: plain.meta?.playbookId || null,
      playbookVersion: plain.meta?.playbookVersion || null,
      createdAt: normalizeDate(plain.createdAt),
      updatedAt: normalizeDate(plain.updatedAt),
    };
  }
  return value.toString();
};

export function mapTicket(doc) {
  if (!doc) return null;
  const ticket = doc.toObject ? doc.toObject({ depopulate: false }) : doc;

  return {
    id: ticket._id ? ticket._id.toString() : undefined,
    ticket_id: ticket.ticket_id,
    project_id: ticket.project_id,
    ticket_subject: ticket.ticket_subject,
    formResult: mapFormResultRef(ticket.formResult),
    assigned_member: mapUserRef(ticket.assigned_member),
    comments: Array.isArray(ticket.comments)
      ? ticket.comments.map((c) => ({
        _id: c._id ? c._id.toString() : undefined,
        comment_content: c.comment_content,
        author: mapUserRef(c.author),
        submittedAt: normalizeDate(c.submittedAt),
        attachments: Array.isArray(c.attachments) ? c.attachments.map((a) => ({
          filename: a.filename,
          originalName: a.originalName,
          mimeType: a.mimeType,
          size: a.size,
          uploadedAt: normalizeDate(a.uploadedAt),
        })) : [],
      }))
      : [],
    state: ticket.state,
    severity: ticket.severity,
    deferred_date: normalizeDate(ticket.deferred_date),
    changelog: Array.isArray(ticket.changelog)
      ? ticket.changelog.map((entry) => ({
        action: entry.action,
        old_value: entry.old_value,
        new_value: entry.new_value,
        changed_field: entry.changed_field,
        changed_question: entry.changed_question,
        user: mapUserRef(entry.user),
        at: normalizeDate(entry.at),
      }))
      : [],
    createdAt: normalizeDate(ticket.createdAt),
    updatedAt: normalizeDate(ticket.updatedAt),
    deletedAt: normalizeDate(ticket.deletedAt) ?? null,
    deletedBy: ticket.deletedBy ?? null,
  };
}

export async function findTicketByIdentifier(identifier) {
  if (!identifier) return null;
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const byId = await TicketModel.findById(identifier);
    if (byId) return byId;
  }
  const numericId = Number.parseInt(identifier, 10);
  if (Number.isInteger(numericId)) {
    return TicketModel.findOne({ ticket_id: numericId });
  }
  return null;
}

export function coerceInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
