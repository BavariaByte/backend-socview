// auth.azure.js
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "./logger.js";

const TENANT_ID = process.env.AZURE_TENANT_ID || "common";
const ISSUER_BASE = process.env.AZURE_AUTHORITY || process.env.OIDC_ISSUER || `https://login.microsoftonline.com/${TENANT_ID}/v2.0/`;
const EXPECTED_AUD = process.env.AZURE_CLIENT_ID || process.env.OIDC_AUDIENCE;    // GUID of the API (client ID)
const OVERRIDE_JWKS = process.env.OIDC_JWKS_URI;   // optional: set directly, otherwise resolved via discovery
const ALLOWED_TENANTS = (process.env.ALLOWED_TENANTS || "").split(",").map(s => s.trim()).filter(Boolean);
// e.g. ALLOWED_TENANTS=1111-...,2222-...

let cached = { jwks: null, issuer: null };

function ensureTrailingSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

async function getOpenIdConfig() {
  if (OVERRIDE_JWKS) {
    return { issuer: ensureTrailingSlash(ISSUER_BASE), jwks_uri: OVERRIDE_JWKS };
  }
  const wellKnown = new URL(".well-known/openid-configuration", ensureTrailingSlash(ISSUER_BASE));
  const res = await fetch(wellKnown, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText} for ${wellKnown}`);
  }
  const cfg = await res.json();
  if (!cfg.issuer || !cfg.jwks_uri) {
    throw new Error("OIDC discovery response missing issuer or jwks_uri");
  }
  return cfg;
}

async function getJWKS() {
  if (cached.jwks && cached.issuer) return cached;
  const cfg = await getOpenIdConfig();
  cached.jwks = createRemoteJWKSet(new URL(cfg.jwks_uri));
  cached.issuer = cfg.issuer; // matches the iss claim in the token
  return cached;
}

export async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    const { jwks, issuer } = await getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: issuer,
      audience: [EXPECTED_AUD, `api://${EXPECTED_AUD}`]
    });

    // Optional: only allow specific tenants
    if (ALLOWED_TENANTS.length && !ALLOWED_TENANTS.includes(payload.tid)) {
      return res.status(403).json({ error: "Tenant not allowed", tid: payload.tid });
    }

    // Azure-specific claims:
    // In v2 tokens, scopes live in 'scp' (space-separated), app roles in 'roles' (array).
    const scopes = payload.scope
      ? (typeof payload.scope === "string" ? payload.scope.split(" ") : payload.scope)
      : (typeof payload.scp === "string" ? payload.scp.split(" ") : []);
    const roles = Array.isArray(payload.roles) ? payload.roles : [];

    req.user = {
      sub: payload.sub,
      tid: payload.tid, // Tenant ID
      oid: payload.oid, // Object ID of the user / service principal
      email: payload.preferred_username || payload.upn || payload.email,
      scope: scopes,
      groups: typeof payload.groups === "string" ? payload.groups.split(" ") : payload.groups,
      roles,
      payload: payload
    };
    // Do NOT log req.user — JWT payload contains PII (email, oid, tid, groups).
    next();
  } catch (err) {
    // Log only the error class, never the token or detailed verify message.
    logger.error({ err }, "[AUTH] token verification failed");
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireScope(...needed) {
  return (req, res, next) => {
    const scopes = new Set(req.user?.scope || []);
    const ok = needed.every(s => scopes.has(s));
    if (!ok) return res.status(403).json({ error: "Insufficient scope", needed });
    next();
  };
}

export function requireRole(...needed) {
  return (req, res, next) => {
    const roles = new Set(req.user?.roles || []);
    const ok = needed.some(r => roles.has(r));
    if (!ok) return res.status(403).json({ error: "Insufficient role", needed });
    next();
  };
}
