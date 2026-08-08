/**
 * Central definition of all available scopes and their assignment to roles.
 */

// All available scopes
export const SCOPES = {
    // Tickets
    TICKET_READ: "tickets:read",
    TICKET_CREATE: "tickets:create",
    TICKET_DELETE: "tickets:delete",
    TICKET_EDIT: "tickets:edit",

    // Playbooks
    PLAYBOOK_MANAGE: "playbooks:manage", // Umbrella scope covering all playbook operations

    // Forms
    FORM_READ: "forms:read",
    FORM_SUBMIT: "forms:submit",

    // Users
    USER_READ: "users:read",
    USER_MANAGE: "users:manage",

    // Admin (Wildcard Access)
    ADMIN_ACCESS: "admin:access"
};

// Mapping: which role grants which scopes?
const ROLE_PERMISSIONS = {
    "admin": ["*"], // Wildcard: grants everything

    "playbook_manager": [
        SCOPES.PLAYBOOK_MANAGE,
        SCOPES.TICKET_READ,
        SCOPES.FORM_READ
    ],

    "user": [
        SCOPES.TICKET_READ,
        SCOPES.TICKET_CREATE,
        SCOPES.TICKET_EDIT,
        SCOPES.FORM_READ,
        SCOPES.FORM_SUBMIT,
        SCOPES.USER_READ
    ],

    // Example of a read-only role
    "auditor": [
        SCOPES.TICKET_READ,
        SCOPES.FORM_READ,
        SCOPES.USER_READ
    ],

    "pending": [],

    "deactivated": []
};

/**
 * Computes all scopes for a user based on their roles.
 *
 * @param {string[]} userRoles - Array of role names (e.g. ["admin", "user"])
 * @returns {string[]} - Array of all granted scopes (deduplicated)
 */
export function getUserScopes(userRoles = []) {
    const scopes = new Set();

    if (!Array.isArray(userRoles)) {
        return [];
    }

    userRoles.forEach(role => {
        // Case-insensitive role matching
        const normalizedRole = role.toLowerCase().trim();
        const roleScopes = ROLE_PERMISSIONS[normalizedRole] || [];

        roleScopes.forEach(scope => scopes.add(scope));
    });

    return Array.from(scopes);
}
