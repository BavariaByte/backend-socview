import { logger } from "../../../lib/logger.js";
import { UserModel } from "@girp/database-models";
import { mapUser, findUserByIdentifier, ensureRolesArray } from "./utils.js";

/**
 * PATCH /api/users/:id
 *
 * Path parameters:
 *   - id (string, required): MongoDB ObjectId or userid of the user to update.
 *
 * Body parameters (all optional, at least one required):
 *   - username (string): New display name.
 *   - e_mail (string): New email address (must remain unique).
 *   - sso_provider (string): Updated authentication provider label.
 *   - roles (string[]): Replaces the assigned role list.
 *
 * Request example:
 * {
 *   "username": "Alice W.",
 *   "roles": ["lead-analyst"]
 * }
 */
export default async function updateUser(req, res) {
  try {
    const user = await findUserByIdentifier(req.params?.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { username, e_mail, sso_provider, roles } = req.body || {};

    // Block role changes on super_admin regardless of who is asking
    if (roles !== undefined && Array.isArray(user.roles) && user.roles.includes('super_admin')) {
      return res.status(403).json({ error: "This user cannot be modified." });
    }

    const updates = {};
    if (username !== undefined) updates.username = username;
    if (sso_provider !== undefined) updates.sso_provider = sso_provider;
    if (e_mail !== undefined) updates.e_mail = e_mail;

    let normalizedRoles;
    if (roles !== undefined) {
      normalizedRoles = ensureRolesArray(roles);
      if (normalizedRoles === null) {
        return res.status(400).json({ error: "roles must be an array of non-empty strings" });
      }
      updates.roles = normalizedRoles;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "At least one updatable field must be provided" });
    }

    if (updates.e_mail) {
      const duplicateEmail = await UserModel.findOne({
        e_mail: updates.e_mail,
        _id: { $ne: user._id },
      });
      if (duplicateEmail) {
        return res.status(409).json({ error: "Another user with the same e_mail exists" });
      }
    }

    Object.assign(user, updates);
    await user.save();

    const fresh = await UserModel.findById(user._id);
    res.json(mapUser(fresh));
  } catch (error) {
    logger.error({ err: error }, "[PATCH /api/users/:id]");
    res.status(500).json({ error: "Unable to update user" });
  }
}
