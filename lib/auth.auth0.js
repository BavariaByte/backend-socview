// auth.auth0.js
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger.js";

const AUTH0_ISSUER = ensureSlash(process.env.AUTH0_OIDC_ISSUER || "");
const AUTH0_AUDIENCES = splitCsv(process.env.AUTH0_OIDC_AUDIENCE || "");
const AUTH0_JWKS_OVERRIDE = (process.env.AUTH0_OIDC_JWKS_URI || "").trim() || null;

const AUTH0_ROLES_CLAIM = process.env.AUTH0_ROLES_CLAIM || "permissions";
const AUTH0_GROUPS_CLAIM = process.env.AUTH0_GROUPS_CLAIM || "";
const AUTH0_EMAIL_CLAIM = process.env.AUTH0_EMAIL_CLAIM || "email";

const CLOCK_TOLERANCE = Number(process.env.OIDC_CLOCK_SKEW_SEC || 60);

// No longer throw if unconfigured — just warn and export null middleware
const AUTH0_CONFIGURED = !!(AUTH0_ISSUER && AUTH0_AUDIENCES.length);
if (!AUTH0_CONFIGURED) {
  logger.warn("[AUTH0] Not configured (AUTH0_OIDC_ISSUER or AUTH0_OIDC_AUDIENCE missing) — Auth0 provider disabled.");
}

let _cache = null; // { jwks, issuer, jwks_uri }

function ensureSlash(u) { return u && !u.endsWith("/") ? u + "/" : u; }
function splitCsv(s) { return s.split(",").map(x => x.trim()).filter(Boolean); }

async function discover(issuer, jwksOverride) {
  if (jwksOverride) return { issuer, jwks_uri: jwksOverride };
  const wellKnown = new URL(".well-known/openid-configuration", issuer);
  const res = await fetch(wellKnown, { redirect: "follow" });
  if (!res.ok) throw new Error(`Auth0 OIDC discovery failed: ${res.status} ${res.statusText}`);
  const cfg = await res.json();
  if (!cfg.issuer || !cfg.jwks_uri) throw new Error("Auth0 discovery missing issuer or jwks_uri");
  return cfg;
}

async function getVerifier() {
  if (_cache) return _cache;
  const cfg = await discover(AUTH0_ISSUER, AUTH0_JWKS_OVERRIDE);
  const jwks = createRemoteJWKSet(new URL(cfg.jwks_uri));
  _cache = { jwks, issuer: cfg.issuer, jwks_uri: cfg.jwks_uri };
  return _cache;
}

/**
 * Middleware for Auth0 tokens only.
 * Expects "Bearer <token>" in the Authorization header.
 * Normalizes req.user so the existing guards (requireScope/requireRole) keep working.
 * Returns null if Auth0 is not configured.
 */
export const requireAuthAuth0 = AUTH0_CONFIGURED ? async function requireAuthAuth0(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const { jwks, issuer } = await getVerifier();
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: AUTH0_AUDIENCES,
      clockTolerance: CLOCK_TOLERANCE
    });

    // Scopes (Auth0 stores them space-separated in 'scope')
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];

    // Roles/Permissions
    let roles = [];
    const rawRoles = payload[AUTH0_ROLES_CLAIM];
    if (Array.isArray(rawRoles)) roles = rawRoles;
    else if (typeof rawRoles === "string") roles = rawRoles.split(" ");

    // Groups (optional namespaced claim)
    let groups;
    if (AUTH0_GROUPS_CLAIM) {
      const g = payload[AUTH0_GROUPS_CLAIM];
      groups = Array.isArray(g) ? g : (typeof g === "string" ? g.split(" ") : undefined);
    }

    const email = payload[AUTH0_EMAIL_CLAIM] || payload.email;

    // req.user shaped to be compatible with the Azure middleware
    req.user = {
      iss: issuer,
      sub: payload.sub,
      tid: undefined,                // not relevant for Auth0
      oid: payload.sub,              // fallback mirroring Azure's oid
      email,
      scope: scopes,
      groups,
      roles,
      payload
    };

    next();
  } catch (err) {
    logger.error({ err }, "[AUTH0] verify error");
    return res.status(401).json({ error: "Invalid token" });
  }
} : null;

export { AUTH0_CONFIGURED };
