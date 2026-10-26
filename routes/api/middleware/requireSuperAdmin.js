import { logger } from "../../../lib/logger.js";

/**
 * Middleware: only the protected super_admin role may pass.
 *
 * Used for irreversible operations that a regular admin must not perform,
 * currently the early permanent deletion of playbooks from the trash.
 */
export default function requireSuperAdmin(req, res, next) {
    const user = req.sessionUser;
    if (!user) {
        return res.status(401).json({ error: "Unauthorized - No session user found" });
    }

    const roles = Array.isArray(user.roles) ? user.roles.map(r => String(r).toLowerCase()) : [];
    if (!roles.includes("super_admin")) {
        logger.info(`[requireSuperAdmin] Access denied for user ${user._id}`);
        return res.status(403).json({ error: "Super admin role required" });
    }

    return next();
}
