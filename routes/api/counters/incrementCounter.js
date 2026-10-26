import { logger } from "../../../lib/logger.js";
import { CounterModel } from "@girp/database-models";
import { mapCounter } from "./utils.js";

/**
 * POST /api/counters/:name/increment
 */
export default async function incrementCounter(req, res) {
  try {
    const counter = await CounterModel.findOneAndUpdate(
      { name: req.params?.name },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json(mapCounter(counter));
  } catch (error) {
    logger.error({ err: error }, "[POST /api/counters/:name/increment]");
    res.status(500).json({ error: "Unable to increment counter" });
  }
}
