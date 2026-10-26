import { logger } from "../../../lib/logger.js";
import { getUserScopes } from "../../../lib/permissions.js";

/**
 * Middleware: checks whether the user has the required scope.
 * Based on the roles in the `req.sessionUser` object.
 *
 * @param {string} requiredScope - The required scope (e.g. "tickets:delete")
 */
export const requireScope = (requiredScope) => {
    return (req, res, next) => {
        try {
            const user = req.sessionUser; // Must be set by ensureAuthenticatedUser

            if (!user) {
                return res.status(401).json({ error: "Unauthorized - No session user found" });
            }

            // Combine DB roles and virtual roles (from Entra/settings via augmentEffectiveRoles)
            const inputRoles = [
                ...(user.roles || []),
                ...(user.virtualRoles || [])
            ];

            const userScopes = getUserScopes(inputRoles);

            // Add direct scopes from the API token (if present)
            if (user.apiTokenScopes && Array.isArray(user.apiTokenScopes)) {
                user.apiTokenScopes.forEach(s => userScopes.push(s));
            }

            // 1. Check Wildcard Admin ("*")
            if (userScopes.includes("*")) {
                return next();
            }

            // 2. Check Specific Scope
            if (userScopes.includes(requiredScope)) {
                return next();
            }

            // 3. (Optional) Check wildcard categories (e.g. "tickets:*")
            // Allows e.g. access to "tickets:delete" when the user has "tickets:*"
            const resource = requiredScope.split(":")[0];
            if (userScopes.includes(`${resource}:*`)) {
                return next();
            }

            // Log the user ID at info level; the email (PII) only at debug.
            logger.info(`[requireScope] Access denied for user ${user._id}. Required: ${requiredScope}, Has: ${userScopes.join(", ")}`);
            logger.debug(`[requireScope] Denied user email: ${user.e_mail}`);
            return res.status(403).json({
                error: `Missing permission: ${requiredScope}`,
                details: "You do not have the required scope to perform this action."
            });

        } catch (error) {
            logger.error({ err: error }, "[requireScope] Middleware Error");
            return res.status(500).json({ error: "Internal Server Error during permission check" });
        }
    };
};
