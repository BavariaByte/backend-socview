import { logger } from "../../../lib/logger.js";
import { CounterModel } from "@girp/database-models";
import { mapCounter } from "../counters/utils.js";

/**
 * GET /api/metrics
 *
 * Returns basic runtime metrics.
 */
export default async function metrics(req, res) {
  try {
    const counters = await CounterModel.find().lean();
    res.json({
      timestamp: new Date().toISOString(),
      counters: counters.map(mapCounter),
      gauges: {},
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/metrics]");
    res.status(500).json({ error: "Unable to load metrics" });
  }
}
