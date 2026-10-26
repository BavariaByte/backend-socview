// auth.combined.js
import { decodeJwt } from "jose";
import crypto from "crypto";
import { ApiToken } from "@girp/database-models";
import { requireAuth as requireAuthAzure } from "./auth.azure.js";
import { requireAuthAuth0, AUTH0_CONFIGURED } from "./auth.auth0.js";
import { getAuthInstance } from "./better-auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { logger } from "./logger.js";

function isEnabled(key) {
  const val = (process.env[key] || "").toLowerCase();
  return val === "true" || val === "1" || val === "yes";
}

function ensureSlash(u) { return u && !u.endsWith("/") ? u + "/" : u; }

// --- Provider Toggle Flags ---
const AZURE_ENABLED = isEnabled("AUTH_AZURE_ENABLED");
const AUTH0_ENABLED = isEnabled("AUTH_AUTH0_ENABLED") && AUTH0_CONFIGURED;
const BETTERAUTH_ENABLED = isEnabled("AUTH_BETTERAUTH_ENABLED");

// --- Issuers (for JWT routing) ---
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || "common";
const AZURE_ISSUER = AZURE_ENABLED ? ensureSlash(process.env.AZURE_AUTHORITY || process.env.OIDC_ISSUER || `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0/`) : "";
const AUTH0_ISSUER = AUTH0_ENABLED ? ensureSlash(process.env.AUTH0_OIDC_ISSUER || "") : "";

// Log active providers
const activeProviders = [];
if (AZURE_ENABLED) activeProviders.push("Azure/Entra");
if (AUTH0_ENABLED) activeProviders.push("Auth0");
if (BETTERAUTH_ENABLED) activeProviders.push("Better-Auth");
logger.info(`[AUTH] Active providers: ${activeProviders.length ? activeProviders.join(", ") : "NONE"}`);

if (!activeProviders.length) {
  logger.warn("[AUTH] No auth providers enabled! Set AUTH_AZURE_ENABLED, AUTH_AUTH0_ENABLED, or AUTH_BETTERAUTH_ENABLED to true.");
}

/**
 * Combined middleware:
 * - Reads iss from the token and dispatches to the matching provider middleware.
 * - The Azure path reuses the existing Azure middleware unchanged.
 * - Better Auth is validated via cookie session.
 */
export async function requireAuthEither(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    // 1. Check Better Auth session (cookie) — only if enabled
    if (BETTERAUTH_ENABLED) {
      const betterAuth = getAuthInstance();
      if (betterAuth) {
        try {
          const session = await betterAuth.api.getSession({ headers: fromNodeHeaders(req.headers) });
          if (session && session.user) {
            logger.info({ userId: session.user.id }, "[AUTH] Better Auth session found for user");
            logger.debug({ email: session.user.email }, "[AUTH] Session user email");
            req.user = {
              email: session.user.email,
              sub: session.user.id,
              oid: session.user.id,
              name: session.user.name,
              image: session.user.image,
              payload: {
                name: session.user.name,
                preferred_username: session.user.email,
                email: session.user.email,
                picture: session.user.image,
                iss: "better-auth"
              }
            };
            req.betterAuthSession = session;
            return next();
          }
        } catch (e) {
          // No Better Auth session - continue with the token check
          logger.debug({ err: e }, "[AUTH] No Better Auth session");
        }
      }
    }

    // 2. Check API token (format: soc_...)
    if (token && token.startsWith("soc_")) {
      const hashed = crypto.createHash("sha256").update(token).digest("hex");
      const apiToken = await ApiToken.findOne({ tokenHash: hashed, isActive: true });

      if (apiToken) {
        // Update usage stats (async, fire & forget). The .catch() keeps a
        // transient DB error from becoming an unhandled rejection, which
        // would take down the whole process via the fatal handler.
        ApiToken.updateOne({ _id: apiToken._id }, { lastUsedAt: new Date() })
          .exec()
          .catch((err) => logger.warn({ err }, "[AUTH] Failed to update API token lastUsedAt"));

        logger.info(`[AUTH] API Token used: ${apiToken.name}`);

        // Set a virtual user for the API token
        req.user = {
          email: `apitoken@system`,
          sub: `token:${apiToken._id}`,
          oid: `token:${apiToken._id}`,
          name: `API Token: ${apiToken.name}`,
          payload: {
            name: apiToken.name,
            iss: "api-token"
          },
          virtualRoles: [],
        };

        req.sessionUser = {
          _id: apiToken.createdBy,
          username: apiToken.name,
          e_mail: "apitoken@system",
          roles: [],
          apiTokenScopes: apiToken.scopes
        };

        return next();
      }
    }

    // 3. Check Bearer token (MSAL/Auth0)
    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token, session cookie or API token" });
    }

    let iss = "";
    try {
      const dec = decodeJwt(token);
      iss = ensureSlash(dec.iss || "");
    } catch {
      return res.status(401).json({ error: "Invalid JWT format" });
    }

    // Route by issuer — enabled providers only
    if (AZURE_ENABLED && AZURE_ISSUER && iss === AZURE_ISSUER) {
      return requireAuthAzure(req, res, next);
    }
    if (AUTH0_ENABLED && AUTH0_ISSUER && iss === AUTH0_ISSUER && requireAuthAuth0) {
      return requireAuthAuth0(req, res, next);
    }

    return res.status(401).json({ error: "Unexpected issuer or provider not enabled", iss });
  } catch (err) {
    logger.error({ err }, "[AUTH] router error");
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Export toggle flags for other modules (e.g. getSettings)
export { AZURE_ENABLED, AUTH0_ENABLED, BETTERAUTH_ENABLED };

// Re-export the guards so existing imports keep working
export { requireScope, requireRole } from "./auth.azure.js";
