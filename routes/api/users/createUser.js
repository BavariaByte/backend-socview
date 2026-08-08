import { logger } from "../../../lib/logger.js";
import { UserModel } from "@girp/database-models";
import { mapUser, ensureRolesArray } from "./utils.js";

/**
 * POST /api/users
 *
 * Body parameters:
 *   - userid (string, required): Unique identifier of the user in the source system.
 *   - sso_provider (string, required): Authentication provider for the user (e.g., Azure, Auth0).
 *   - username (string, required): Display name of the user.
 *   - e_mail (string, required): Email address of the user.
 *   - roles (string[], optional): List of role identifiers to assign.
 *
 * Request example:
 * {
 *   "userid": "alice.wonder",
 *   "sso_provider": "Azure",
 *   "username": "Alice Wonder",
 *   "e_mail": "alice@wonder.land",
 *   "roles": ["analyst", "on-call"]
 * }
 *
 * Response example:
 * Status: 201 Created
 * {
 *   "id": "6512f5f4e1f1a0c123456789",
 *   "userid": "alice.wonder",
 *   "sso_provider": "Azure",
 *   "username": "Alice Wonder",
 *   "e_mail": "alice@wonder.land",
 *   "roles": ["analyst", "on-call"],
 *   "createdAt": "2025-09-21T00:12:34.567Z",
 *   "updatedAt": "2025-09-21T00:12:34.567Z"
 * }
 */
export default async function createUser(req, res) {
  try {
    const { userid, sso_provider, username, e_mail, roles } = req.body || {};

    // Guard against NoSQL operator injection (e.g. { "$ne": null }) on scalar fields.
    if (typeof userid !== "string" ||
        typeof sso_provider !== "string" ||
        typeof username !== "string" ||
        typeof e_mail !== "string") {
      return res.status(400).json({ error: "userid, sso_provider, username and e_mail must be strings" });
    }

    if (!userid || !sso_provider || !username || !e_mail) {
      return res.status(400).json({ error: "userid, sso_provider, username and e_mail are required" });
    }

    const normalizedRoles = roles === undefined ? undefined : ensureRolesArray(roles);
    if (roles !== undefined && normalizedRoles === null) {
      return res.status(400).json({ error: "roles must be an array of non-empty strings" });
    }

    const duplicate = await UserModel.findOne({
      $or: [{ userid }, { e_mail }],
    });
    if (duplicate) {
      return res.status(409).json({ error: "User already exists" });
    }

    const user = await UserModel.create({
      userid,
      sso_provider,
      username,
      e_mail,
      roles: normalizedRoles ?? [],
    });

    const created = await UserModel.findById(user._id);
    res.status(201).json(mapUser(created));
  } catch (error) {
    logger.error({ err: error }, "[POST /api/users]");
    res.status(500).json({ error: "Unable to create user" });
  }
}
