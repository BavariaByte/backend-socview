/**
 * Centralized environment validation & helpers.
 *
 * Goals:
 *  - Reject ambiguous NODE_ENV values at startup so production cannot
 *    accidentally inherit dev-mode behavior (e.g. auto-admin).
 *  - Surface missing security-critical secrets prominently in production
 *    instead of silently using a per-process random fallback.
 */

const RAW_NODE_ENV = (process.env.NODE_ENV || "").toLowerCase().trim();

/**
 * Resolve NODE_ENV into one of two canonical values: "production" or
 * "development". Anything else — including an unset/empty value — is a hard
 * configuration error: development mode grants conveniences (e.g. auto-admin
 * for users without roles) that must never be reached by accident.
 */
function resolveNodeEnv(value) {
    if (value === "production" || value === "prod") return "production";
    if (value === "development" || value === "dev") return "development";
    return null;
}

const RESOLVED_NODE_ENV = resolveNodeEnv(RAW_NODE_ENV);

if (RESOLVED_NODE_ENV === null) {
    // Hard-fail rather than degrading silently — an unrecognized or missing
    // NODE_ENV in a SOC backend is a configuration footgun.

    console.error(
        RAW_NODE_ENV === ""
            ? "[env] FATAL: NODE_ENV is not set. Set NODE_ENV=production for " +
              "deployments or NODE_ENV=development for local development. " +
              "Aborting startup."
            : `[env] FATAL: NODE_ENV='${RAW_NODE_ENV}' is not recognized. ` +
              "Allowed values: production, prod, development, dev. Aborting startup."
    );
    process.exit(1);
}

export const NODE_ENV = RESOLVED_NODE_ENV;
export const IS_PRODUCTION = NODE_ENV === "production";
export const IS_DEV = NODE_ENV === "development";

/**
 * Loud, visible warning — printed to stderr so it survives standard pipe
 * redirection and shows up in container logs. Used for non-fatal config issues
 * the operator should still address.
 */
function warnLoudly(lines) {
    const banner = "=".repeat(72);

    console.warn(`\n${banner}\n${lines.join("\n")}\n${banner}\n`);
}

/**
 * Validate environment at boot time. Called once from server.js.
 * Returns nothing on success; logs warnings for missing optional vars and
 * aborts on hard-required ones.
 */
export function validateEnvOrExit() {

    // Informational only — keep production logs clean (the pino logger cannot
    // be used here: lib/logger.js itself imports this module).
    if (IS_DEV) {
        console.log(`[env] NODE_ENV resolved to '${NODE_ENV}'`);
    }

    // The email/password login creates accounts without email verification, so
    // it must not be reachable in a production deployment by accident. It is
    // allowed in exactly one case: a deliberate demo instance (DEMO_MODE=true),
    // which is what the hosted demo runs on. Forcing that instance into
    // NODE_ENV=development instead would be worse — it would hand out the dev
    // conveniences (auto-admin for role-less users, non-secure cookies) to a
    // publicly reachable site.
    const demoMode = (process.env.DEMO_MODE || "").toLowerCase() === "true";
    const emailPasswordEnabled =
        (process.env.AUTH_EMAIL_PASSWORD_ENABLED || "").toLowerCase() === "true";

    if (IS_PRODUCTION && emailPasswordEnabled && !demoMode) {

        console.error(
            "[env] FATAL: AUTH_EMAIL_PASSWORD_ENABLED=true with " +
            "NODE_ENV=production. Email/password sign-in creates accounts " +
            "without email verification and is only supported as part of a " +
            "demo instance. Either set DEMO_MODE=true (public demo, shows the " +
            "demo warning in the UI) or use an SSO provider. Aborting startup."
        );
        process.exit(1);
    }

    if (IS_PRODUCTION && demoMode) {
        warnLoudly([
            "[env] WARNING: DEMO_MODE=true with NODE_ENV=production.",
            "      This instance runs as a public demo:",
            "        - Email/password sign-in without email verification.",
            "        - The login screen shows the demo disclaimer.",
            "      Action: if this is a real installation, unset DEMO_MODE and",
            "      AUTH_EMAIL_PASSWORD_ENABLED and restart.",
        ]);
    }

    // CSRF_SECRET — H-10: not a hard-fail (the app worked without it before),
    // but in production we want a loud warning so operators notice that all
    // CSRF tokens are tied to a per-process random secret (= invalidated on
    // restart, inconsistent across replicas).
    if (IS_PRODUCTION && !process.env.CSRF_SECRET) {
        warnLoudly([
            "[env] WARNING: CSRF_SECRET is not set in production.",
            "      A random per-process fallback will be used instead.",
            "      Consequences:",
            "        - All CSRF tokens become invalid on every restart.",
            "        - Behind a load balancer, replicas reject each other's tokens.",
            "      Action: set a stable CSRF_SECRET (e.g. `openssl rand -hex 32`)",
            "      in the deployment environment.",
        ]);
    }

    // Placeholder or too-short secrets must never survive into production —
    // session/CSRF tokens signed with publicly known example values are
    // forgeable. Absence is handled separately (warning above / library check).
    const PLACEHOLDER_SECRETS = new Set([
        "change-me",
        "change_me",
        "changeme",
        "secret",
        "password",
        "dev-session-secret",
    ]);
    const MIN_SECRET_LENGTH = 32;

    if (IS_PRODUCTION) {
        for (const name of ["CSRF_SECRET", "BETTER_AUTH_SECRET"]) {
            const value = (process.env[name] || "").trim();
            if (!value) continue;
            if (PLACEHOLDER_SECRETS.has(value.toLowerCase()) || value.length < MIN_SECRET_LENGTH) {

                console.error(
                    `[env] FATAL: ${name} is a known placeholder or shorter than ` +
                    `${MIN_SECRET_LENGTH} characters. Generate a strong value ` +
                    "(e.g. `openssl rand -hex 32`) and set it in the deployment " +
                    "environment. Aborting startup."
                );
                process.exit(1);
            }
        }
    }

    // ALLOWED_TENANTS — M-12: hard-fail only when Azure is configured to use a
    // *multi-tenant* endpoint. With a single-tenant AZURE_TENANT_ID, the issuer
    // claim already pins tokens to that one tenant (auth.azure.js — jwtVerify
    // rejects mismatched `iss`), and ALLOWED_TENANTS is redundant.
    const azureEnabled = (process.env.AUTH_AZURE_ENABLED || "").toLowerCase() === "true";
    const allowedTenants = (process.env.ALLOWED_TENANTS || "").trim();
    const azureTenantId = (process.env.AZURE_TENANT_ID || "").trim().toLowerCase();
    const MULTI_TENANT_VALUES = new Set(["", "common", "organizations", "consumers"]);
    const isMultiTenant = MULTI_TENANT_VALUES.has(azureTenantId);

    if (IS_PRODUCTION && azureEnabled && isMultiTenant && !allowedTenants) {

        console.error(
            "[env] FATAL: AUTH_AZURE_ENABLED=true in production with a multi-tenant " +
            `AZURE_TENANT_ID ('${azureTenantId || "(unset → defaults to 'common')"}') ` +
            "and no ALLOWED_TENANTS allowlist. The backend would otherwise accept " +
            "tokens from every Microsoft tenant. Either set AZURE_TENANT_ID to a " +
            "specific tenant GUID, or configure ALLOWED_TENANTS=<tenant-id>[,...]."
        );
        process.exit(1);
    }
}

export const LOG_LEVEL = (() => {
    const v = (process.env.LOG_LEVEL || "info").toLowerCase();
    const valid = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
    return valid.includes(v) ? v : "info";
})();
