import { logger } from "../../../lib/logger.js";
import { UserModel } from "@girp/database-models";
import { mapUser } from "./utils.js";
import { escapeRegex } from "../middleware/sanitize.js";

/**
 * GET /api/users
 *
 * Query parameters:
 *   - limit (number, optional): Maximum number of users to return (default 25, max 200)
 *   - offset (number, optional): Number of users to skip before collecting results (default 0)
 *   - q (string, optional): Case-insensitive search term applied to userid, username, or e_mail
 *   - ssoProvider (string, optional): Exact match filter for the user's SSO provider
 *
 * Request example:
 *   GET /api/users?limit=10&offset=0&q=alice&ssoProvider=Azure
 *
 * Response example:
 * {
 *   "data": [
 *     {
 *       "id": "6512f5f4e1f1a0c123456789",
 *       "userid": "alice.wonder",
 *       "sso_provider": "Azure",
 *       "username": "Alice Wonder",
 *       "e_mail": "alice@wonder.land",
 *       "roles": ["analyst"],
 *       "createdAt": "2025-09-21T00:12:34.567Z",
 *       "updatedAt": "2025-09-21T10:45:00.123Z"
 *     }
 *   ],
 *   "pagination": { "total": 42, "limit": 10, "offset": 0 }
 * }
 */

function parsePagination(query = {}) {
  const MAX_LIMIT = 200;
  const limitRaw = Number.parseInt(query.limit, 10);
  const offsetRaw = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : 25;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  return { limit, offset };
}


export default async function listUsers(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const filter = {};

    if (req.query?.q) {
      // Escape regex meta-characters to prevent ReDoS / unintended matches.
      // Cap length to bound the search term and avoid pathological inputs.
      const rawQ = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
      if (rawQ) {
        const regex = new RegExp(escapeRegex(rawQ), "i");
        filter.$or = [
          { userid: regex },
          { username: regex },
          { e_mail: regex },
        ];
      }
    }

    if (req.query?.ssoProvider) {
      if (typeof req.query.ssoProvider !== 'string') {
        return res.status(400).json({ error: "Invalid ssoProvider filter" });
      }
      filter.sso_provider = req.query.ssoProvider;
    }

    const [total, users] = await Promise.all([
      UserModel.countDocuments(filter),
      UserModel.find(filter)
        .skip(offset)
        .limit(limit)
        .lean({ getters: false, virtuals: false }),
    ]);

    res.json({
      data: users.map(mapUser),
      pagination: { total, limit, offset },
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/users]");
    res.status(500).json({ error: "Unable to list users" });
  }
}
