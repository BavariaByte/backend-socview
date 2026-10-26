import { logger } from "../../../lib/logger.js";
import { CounterModel } from "@girp/database-models";
import { mapCounter } from "./utils.js";

/**
 * PATCH /api/counters/:name/reset
 *
 * Body parameters:
 *   - value (number, required): New counter value (>= 0)
 */
export default async function resetCounter(req, res) {
  try {
    const value = Number.parseInt(req.body?.value, 10);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: "value must be a non-negative integer" });
    }

    const counter = await CounterModel.findOneAndUpdate(
      { name: req.params?.name },
      { $set: { value } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json(mapCounter(counter));
  } catch (error) {
    logger.error({ err: error }, "[PATCH /api/counters/:name/reset]");
    res.status(500).json({ error: "Unable to reset counter" });
  }
}
