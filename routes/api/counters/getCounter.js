import { logger } from "../../../lib/logger.js";
import { mapCounter, getCounterByName } from "./utils.js";

/**
 * GET /api/counters/:name
 */
export default async function getCounter(req, res) {
  try {
    const counter = await getCounterByName(req.params?.name);
    if (!counter) {
      return res.status(404).json({ error: "Counter not found" });
    }
    res.json(mapCounter(counter));
  } catch (error) {
    logger.error({ err: error }, "[GET /api/counters/:name]");
    res.status(500).json({ error: "Unable to load counter" });
  }
}
