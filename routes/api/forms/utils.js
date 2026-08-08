import mongoose from "mongoose";
import { FormResult } from "@girp/database-models";

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

export function mapFormResult(doc) {
  if (!doc) return null;
  const result = doc.toObject ? doc.toObject({ depopulate: true }) : doc;
  const normalizeDate = (d) => (d instanceof Date ? d.toISOString() : d);
  return {
    id: result._id ? result._id.toString() : undefined,
    formKey: result.formKey,
    formVersion: result.formVersion,
    formHash: result.formHash,
    answers: result.answers,
    actor: result.actor,
    submittedAt: normalizeDate(result.submittedAt),
    meta: result.meta,
    createdAt: normalizeDate(result.createdAt),
    updatedAt: normalizeDate(result.updatedAt),
  };
}

export async function findFormResultById(formId, resultId) {
  if (!mongoose.Types.ObjectId.isValid(resultId)) return null;
  return FormResult.findOne({ _id: resultId, formKey: formId });
}
