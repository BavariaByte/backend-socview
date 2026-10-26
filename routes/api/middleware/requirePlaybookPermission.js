import { logger } from "../../../lib/logger.js";
import { Settings } from "@girp/database-models";
import { IS_DEV } from "../../../lib/env.js";

/**
 * Middleware: checks whether the user has playbook management rights.
 *
 * Granted to:
 * - Admins (via requireAdmin logic or the 'admin' role)
 * - Users with the 'playbook_manager' role
 * - Users in the Entra playbook_manager group (Microsoft auth)
 * - Users on the playbook_manager email list (BetterAuth)
 */
/**
 * Core logic: checks whether the user has playbook rights.
 */
export const checkIsPlaybookManager = async (user, dbUser) => {
    const isDev = IS_DEV;
    const hasRoles = dbUser?.roles && dbUser.roles.length > 0;

    // Smart DEV mode
    if (isDev) {
        if (!hasRoles) return false;

        const normalizedRoles = dbUser.roles.map(r => r.toLowerCase().trim());
        if (normalizedRoles.includes("admin") || normalizedRoles.includes("playbook_manager")) {
            return true;
        }
        return false;
    }

    const userEmail = user.email?.toLowerCase();
    const superuserEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();

    if (superuserEmail && userEmail === superuserEmail) {
        return true;
    }

    const roles = dbUser?.roles || [];
    const normalizedRoles = roles.map(r => r.toLowerCase().trim());

    if (normalizedRoles.includes("admin") || normalizedRoles.includes("playbook_manager")) {
        return true;
    }

    const azureEnabled = (process.env.AUTH_AZURE_ENABLED || "").toLowerCase() === "true";
    const betterAuthEnabled = (process.env.AUTH_BETTERAUTH_ENABLED || "").toLowerCase() === "true";

    // Check Entra groups if Azure is enabled
    if (azureEnabled) {
        const adminGroupSetting = await Settings.findOne({ key: "entra_admin_group" });
        const managerGroupSetting = await Settings.findOne({ key: "entra_playbook_manager_group" });
        const userGroups = user.groups || [];

        if (adminGroupSetting?.value && userGroups.includes(adminGroupSetting.value)) return true;
        if (managerGroupSetting?.value && userGroups.includes(managerGroupSetting.value)) return true;
    }

    // Check email lists if BetterAuth is enabled
    if (betterAuthEnabled) {
        const adminEmailsSetting = await Settings.findOne({ key: "admin_emails" });
        const managerEmailsSetting = await Settings.findOne({ key: "playbook_manager_emails" });

        const adminEmails = (adminEmailsSetting?.value || []).map(e => e.toLowerCase());
        const managerEmails = (managerEmailsSetting?.value || []).map(e => e.toLowerCase());

        if (adminEmails.includes(userEmail) || managerEmails.includes(userEmail)) return true;
    }

    return false;
};

/**
 * Middleware: checks whether the user has playbook management rights.
 */
const requirePlaybookPermission = async (req, res, next) => {
    try {
        const user = req.user;
        const dbUser = req.sessionUser;

        if (!user) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const hasPermission = await checkIsPlaybookManager(user, dbUser);

        if (hasPermission) {
            return next();
        }

        return res.status(403).json({ error: "No permission for playbook management" });

    } catch (error) {
        logger.error({ err: error }, "[requirePlaybookPermission] Error");
        return res.status(500).json({ error: "Permission check failed" });
    }
};

export default requirePlaybookPermission;
