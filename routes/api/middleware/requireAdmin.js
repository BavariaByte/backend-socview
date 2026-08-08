import { logger } from "../../../lib/logger.js";
import { Settings } from "@girp/database-models";
import { IS_DEV } from "../../../lib/env.js";

/**
 * Core logic: checks whether a user has admin rights.
 * @param {Object} user - The authentication object (from the SSO token)
 * @param {Object} [dbUser] - The user's database record (optional, for role checks)
 * @returns {Promise<boolean>}
 */
export const checkIsAdmin = async (user, dbUser) => {
    if (!user) return false;

    const isDev = IS_DEV;
    const hasRoles = dbUser?.roles && dbUser.roles.length > 0;

    // Smart DEV mode (explicit NODE_ENV=development only — startup aborts on
    // an unset NODE_ENV):
    // 1. No roles assigned -> default admin (convenience).
    // 2. Roles assigned -> strictly check DB roles only (testing). Entra/email
    //    groups are deliberately ignored so you can test as a plain "user"
    //    even if you would be admin in production.
    if (isDev) {
        if (!hasRoles) return true;
        return dbUser.roles.map(r => r.toLowerCase()).includes("admin");
    }

    const userEmail = user.email?.toLowerCase();
    const superuserEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();

    // 1. Check: Superuser
    if (superuserEmail && userEmail === superuserEmail) {
        return true;
    }

    // 2. Check: DB Role 'admin'
    if (hasRoles && dbUser.roles.map(r => r.toLowerCase()).includes("admin")) {
        return true;
    }

    // 3. Check: Entra Admin Group & Email Whitelist
    const [adminGroupSetting, adminEmailsSetting] = await Promise.all([
        Settings.findOne({ key: "entra_admin_group" }),
        Settings.findOne({ key: "admin_emails" })
    ]);

    // Entra Group
    if (adminGroupSetting?.value && Array.isArray(user.groups)) {
        if (user.groups.includes(adminGroupSetting.value)) {
            return true;
        }
    }

    // Email Whitelist
    const adminEmails = adminEmailsSetting?.value || [];
    if (Array.isArray(adminEmails) && adminEmails.map(e => e.toLowerCase()).includes(userEmail)) {
        return true;
    }

    return false;
};

/**
 * Middleware: checks whether the user has admin rights.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const user = req.user;
        const dbUser = req.sessionUser; // Provided by ensureAuthenticatedUser

        if (!user) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const isAdmin = await checkIsAdmin(user, dbUser);
        // Log the user ID at info level; the email (PII) only at debug.
        const userId = dbUser?._id || user.sub || user.oid;

        if (isAdmin) {
            logger.info(`[requireAdmin] Access granted for user ${userId}`);
            logger.debug(`[requireAdmin] Granted user email: ${user.email}`);
            return next();
        }

        logger.info(`[requireAdmin] Access denied for user ${userId}`);
        logger.debug(`[requireAdmin] Denied user email: ${user.email}`);
        return res.status(403).json({ error: "Missing admin permission." });

    } catch (error) {
        logger.error({ err: error }, "[requireAdmin] Error");
        return res.status(500).json({ error: "Permission check failed" });
    }
};

export default requireAdmin;
