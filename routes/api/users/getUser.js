import { logger } from "../../../lib/logger.js";
import { mapUser, findUserByIdentifier } from "./utils.js";

/**
 * GET /api/users/:id
 *
 * Path parameters:
 *   - id (string, required): Either the MongoDB ObjectId of the user or the userid value.
 *
 * Response example:
 * {
 *   "id": "6512f5f4e1f1a0c123456789",
 *   "userid": "alice.wonder",
 *   "sso_provider": "Azure",
 *   "username": "Alice Wonder",
 *   "e_mail": "alice@wonder.land",
 *   "roles": ["analyst"],
 *   "createdAt": "2025-09-21T00:12:34.567Z",
 *   "updatedAt": "2025-09-21T10:45:00.123Z"
 * }
 */
export default async function getUser(req, res) {
  try {
    const user = await findUserByIdentifier(req.params?.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(mapUser(user));
  } catch (error) {
    logger.error({ err: error }, "[GET /api/users/:id]");
    res.status(500).json({ error: "Unable to retrieve user" });
  }
}
