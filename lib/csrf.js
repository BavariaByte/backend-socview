/**
 * CSRF protection configuration (double submit cookie pattern)
 *
 * Uses the "csrf-csrf" npm package. The CSRF token is stored in a cookie
 * AND must be sent by the frontend in the "x-csrf-token" header on
 * state-changing requests.
 */
import { doubleCsrf } from "csrf-csrf";
import crypto from "crypto";
import { IS_PRODUCTION } from "./env.js";

// Fallback secret is generated once at startup (not persistent across restarts!)
// In production without CSRF_SECRET, lib/env.js emits a prominent warning.
const FALLBACK_SECRET = crypto.randomBytes(32).toString("hex");

const {
    doubleCsrfProtection,
    generateCsrfToken,
    invalidCsrfTokenError,
} = doubleCsrf({
    // Secret for HMAC generation
    getSecret: () => process.env.CSRF_SECRET || FALLBACK_SECRET,

    // Session identifier: uses the Better Auth session cookie.
    // For API token requests (Bearer soc_...) the token hash is used instead.
    // For unauthenticated requests (e.g. fetching a CSRF token before login) a constant is used.
    getSessionIdentifier: (req) => {
        // Better Auth session cookie
        const sessionCookie =
            req.cookies?.["better-auth.session_token"] ||
            req.cookies?.["__Secure-better-auth.session_token"] || "";
        if (sessionCookie) return sessionCookie;

        // Bearer token (API token or JWT requests)
        const auth = req.headers?.authorization || "";
        if (auth.startsWith("Bearer ")) return auth.slice(7);

        // Fallback for unauthenticated requests
        return "anonymous";
    },

    // Cookie name without __Host- prefix (no HTTPS in dev)
    cookieName: "__csrf",

    // Cookie options
    cookieOptions: {
        httpOnly: true,
        sameSite: "lax",    // "lax" allows top-level navigations to carry the cookie
        path: "/",
        secure: IS_PRODUCTION,
    },

    // GET, HEAD, OPTIONS are exempt by default
    ignoredMethods: ["GET", "HEAD", "OPTIONS"],

    // Token extraction from the request header
    getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

export { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError };
