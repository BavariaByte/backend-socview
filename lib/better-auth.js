
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import mongoose from "mongoose";
import { logger } from "./logger.js";
import { IS_PRODUCTION } from "./env.js";

/**
 * Better-Auth configuration for multi-SSO support
 *
 * Supported providers:
 * - Google
 * - Slack
 *
 * IMPORTANT: Add the credentials to .env before enabling a provider.
 *
 * The legacy MSAL integration in auth.js remains available as a fallback.
 */
export let auth;

/**
 * Initializes Better-Auth AFTER the DB connection is established.
 */
export const initAuth = () => {
    // BETTER_AUTH_URL = public-facing backend URL (as the browser sees it)
    // In Docker: should be http://<host>:3000 (the exposed port)
    // Default fallback for local dev
    const publicBackendUrl = (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
    const baseURL = `${publicBackendUrl}/api/auth`;
    logger.info(`[Better-Auth] FORCED baseURL: ${baseURL}`);

    // Build trusted origins from the two canonical URL variables.
    const trustedOrigins = [
        process.env.PLATFORM_URL,
        process.env.INPUTFORM_URL,
    ].filter(Boolean);
    if (!trustedOrigins.length) trustedOrigins.push("http://localhost:5173");
    logger.info({ trustedOrigins }, "[Better-Auth] Trusted origins");

    // Cross-subdomain cookie support (e.g. form.girp.example.com ↔ api.girp.example.com).
    // Set BETTER_AUTH_COOKIE_DOMAIN=.girp.example.com in production.
    const cookieDomain = process.env.BETTER_AUTH_COOKIE_DOMAIN || null;

    // Secure session cookies (`Secure` flag + `__Secure-` name prefix), so the
    // session token can never travel over plain HTTP. Same rule as the CSRF
    // cookie (lib/csrf.js) — the two must not drift apart, otherwise one of them
    // is silently dropped by the browser.
    //
    // Deliberately NOT derived from the baseURL protocol (which is what
    // Better-Auth does by default): the backend normally speaks plain HTTP
    // behind a TLS-terminating reverse proxy, so BETTER_AUTH_URL may well be
    // http:// while the browser reaches the API over HTTPS.
    const secureCookies = IS_PRODUCTION;

    if (secureCookies && publicBackendUrl.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(publicBackendUrl)) {
        logger.warn(
            `[Better-Auth] Secure cookies are on (NODE_ENV=production) but BETTER_AUTH_URL is plain HTTP (${publicBackendUrl}). ` +
            "This only works behind a TLS-terminating proxy — on a genuinely HTTP-only deployment the browser drops the session cookie."
        );
    }

    // Only register social providers whose credentials are fully configured.
    // Initializing a provider with empty clientId/clientSecret leads to obscure
    // runtime failures instead of a clean "provider not enabled" outcome.
    const socialProviders = {};
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        socialProviders.google = {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
        };
    }
    if (process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET) {
        socialProviders.slack = {
            clientId: process.env.SLACK_CLIENT_ID,
            clientSecret: process.env.SLACK_CLIENT_SECRET,
        };
    }

    auth = betterAuth({
        baseURL: baseURL,
        trustedOrigins: trustedOrigins,

        advanced: {
            // Set explicitly instead of relying on the library's implicit
            // baseURL sniffing — the cookie flags are a security boundary and
            // must not change silently with an unrelated config edit.
            useSecureCookies: secureCookies,
            defaultCookieAttributes: {
                httpOnly: true,
                secure: secureCookies,
                // "none" is only legal together with Secure — browsers drop the
                // cookie otherwise. Subdomains of one registrable domain are
                // same-site anyway, so "lax" still works for the cross-subdomain
                // setup; it is merely stricter.
                sameSite: cookieDomain && secureCookies ? "none" : "lax",
                ...(cookieDomain ? { domain: cookieDomain } : {}),
            },
        },

        // MongoDB database adapter
        // IMPORTANT: mongoose.connection.db is only available after connecting!
        database: mongodbAdapter(mongoose.connection.db),

        socialProviders,

        // Email/password is a CORE better-auth option (not a plugin). Enabled
        // only when AUTH_EMAIL_PASSWORD_ENABLED=true (e.g. the launcher demo login).
        ...(process.env.AUTH_EMAIL_PASSWORD_ENABLED === 'true'
            ? { emailAndPassword: { enabled: true, requireEmailVerification: false } }
            : {}),

        // Session: 8h max lifetime, 30min idle (sliding window).
        session: {
            expiresIn: 60 * 60 * 8,   // 8 hours absolute lifetime
            updateAge: 60 * 30,       // Idle timeout: session expires after 30min of inactivity
            cookieCache: {
                enabled: false,
                maxAge: 60 * 5,
            },
        },

        // Additional user fields
        user: {
            additionalFields: {
                role: {
                    type: "string",
                    required: false,
                    defaultValue: "user",
                },
            },
        },
    });
    return auth;
};

/**
 * Helper to determine which providers are available
 */
export function getAvailableProviders() {
    const providers = [];

    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
        providers.push({ id: "google", name: "Google", icon: "google" });
    }
    if (process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET) {
        providers.push({ id: "slack", name: "Slack", icon: "slack" });
    }

    return providers;
}

/**
 * Returns the initialized auth instance (for middleware access)
 */
export function getAuthInstance() {
    return auth;
}
