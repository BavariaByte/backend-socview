import { logger } from "../../../lib/logger.js";
import { UserModel } from "@girp/database-models";
import { mapUser, findUserByIdentifier, ensureRolesArray } from "./utils.js";

/**
 * Whitelist of role names assignable through this endpoint.
 *
 * Mirrors the keys of ROLE_PERMISSIONS in lib/permissions.js plus the lifecycle
 * flags `pending` / `deactivated` used by ensureAuthenticatedUser.
 *
 * `super_admin` is intentionally NOT assignable here — it is bound to
 * SUPER_ADMIN_EMAIL and managed by syncSuperAdmin.
 */
const ASSIGNABLE_ROLES = new Set([
  "admin",
  "playbook_manager",
  "user",
  "auditor",
  "pending",
  "deactivated",
]);

/**
 * POST /api/users/:id/roles
 *
 * Path parameters:
 *   - id (string, required): MongoDB ObjectId or userid of the user.
 *
 * Body parameters:
 *   - roles (string[], required): Full list of roles to set.
 *     Only the following are allowed: admin, playbook_manager, user, auditor,
 *     pending, deactivated. `super_admin` is not assignable.
 */
export default async function setUserRoles(req, res) {
  try {
    const user = await findUserByIdentifier(req.params?.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.sessionUser && user._id.toString() === req.sessionUser._id.toString()) {
      return res.status(403).json({ error: "You cannot change your own role" });
    }

    // Block modification of super_admin regardless of who is asking
    if (Array.isArray(user.roles) && user.roles.includes('super_admin')) {
      return res.status(403).json({ error: "This user cannot be modified." });
    }

    const roles = ensureRolesArray(req.body?.roles);
    if (roles === null) {
      return res.status(400).json({ error: "roles must be provided as an array of non-empty strings" });
    }

    // Whitelist check — block unknown / privilege-escalation role names.
    const invalid = roles.filter((r) => !ASSIGNABLE_ROLES.has(r));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `Unknown roles: ${invalid.join(", ")}. Allowed: ${[...ASSIGNABLE_ROLES].join(", ")}`,
      });
    }

    // strict:true ensures unknown fields cannot be smuggled into the document.
    await UserModel.updateOne({ _id: user._id }, { $set: { roles } }, { strict: true });
    const fresh = await UserModel.findById(user._id);
    res.json(mapUser(fresh));
  } catch (error) {
    logger.error({ err: error }, "[POST /api/users/:id/roles]");
    res.status(500).json({ error: "Unable to update user roles" });
  }
}
