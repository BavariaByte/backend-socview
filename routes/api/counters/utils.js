import { CounterModel } from "@girp/database-models";

export function mapCounter(doc) {
  if (!doc) return null;
  return {
    name: doc.name,
    value: doc.value,
  };
}

export async function getCounterByName(name) {
  if (!name) return null;
  return CounterModel.findOne({ name });
}
