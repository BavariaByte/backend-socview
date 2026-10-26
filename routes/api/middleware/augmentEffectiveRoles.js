import { logger } from "../../../lib/logger.js";
import { checkIsAdmin } from "./requireAdmin.js";
import { checkIsPlaybookManager } from "./requirePlaybookPermission.js";

/**
 * Middleware: computes effective roles based on legacy logic (Entra, settings, env)
 * and attaches them to the user object as `virtualRoles`.
 *
 * This enables the transition to scopes without losing the existing Entra configuration.
 */
export default async function augmentEffectiveRoles(req, res, next) {
    try {
        const user = req.user;
        const dbUser = req.sessionUser;

        if (!dbUser) {
            // Should not happen thanks to ensureAuthenticatedUser, but just in case
            return next();
        }

        dbUser.virtualRoles = [];

        // 1. Check for admin rights (legacy logic)
        const isAdmin = await checkIsAdmin(user, dbUser);
        if (isAdmin) {
            dbUser.virtualRoles.push("admin");
        }

        // 2. Check for playbook manager rights (legacy logic)
        // Note: checkIsPlaybookManager returns true for admins as well.
        // That is fine, since playbook manager scopes are a subset of admin.
        const isManager = await checkIsPlaybookManager(user, dbUser);
        if (isManager && !dbUser.virtualRoles.includes("playbook_manager")) {
            dbUser.virtualRoles.push("playbook_manager");
        }

        // 3. Default "user" role (if no others apply)
        // permissions.js maps "user" to the standard scopes
        if (!dbUser.virtualRoles.length && (!dbUser.roles || dbUser.roles.length === 0)) {
            dbUser.virtualRoles.push("user");
        }

        next();
    } catch (error) {
        logger.error({ err: error }, "[augmentEffectiveRoles] Error");
        // Fail closed -> 500
        res.status(500).json({ error: "Failed to compute roles" });
    }
}
