import "dotenv/config.js";
import express from "express";
import mongoose from "mongoose";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { initAuth, getAvailableProviders } from "./lib/better-auth.js";
import apiRouter from "./routes/api/index.js";
import { doubleCsrfProtection, generateCsrfToken } from "./lib/csrf.js";
import { AUTH_SENSITIVE_PATHS } from "./lib/authSensitivePaths.js";
import { validateEnvOrExit, IS_DEV, NODE_ENV, LOG_LEVEL } from "./lib/env.js";
import { logger } from "./lib/logger.js";

import { automationService } from "./services/automationService.js";
import { startTicketWatcher } from "./services/ticketWatcher.js";
import { startUpdateChecker } from "./services/updateChecker.js";

// Validate environment FIRST — may abort the process for unrecoverable misconfig.
validateEnvOrExit();

// Process-level safety nets: without these, Node terminates the process on an
// unhandled rejection without any useful log line — the crash cause would be
// invisible in production. Log the cause at fatal level, then exit.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "[server] unhandled rejection");
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "[server] uncaught exception");
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3000;

// Global API rate limit: keep generous (120 req/min) — sensitive endpoints
// (auth, email, tokens) get stricter, dedicated limiters below.
const apiRateLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true });

// Stricter limiter for endpoints that send email or have user-enumeration potential.
const authSensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  message: { error: "Too many requests, please try again later." },
});

// Brute-force limiter for credential endpoints (sign-in/sign-up/password).
// Only failed attempts count, so legitimate users behind a shared IP are
// not locked out by successful logins.
const authCredentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  skipSuccessfulRequests: true,
  message: { error: "Too many authentication attempts, please try again later." },
});

// Placeholder for the auth handler, which is only ready after the DB connects
let authHandler;

app.disable("etag");
// Trust one hop of reverse proxy (nginx / Traefik in Docker).
// Required so express-rate-limit can read X-Forwarded-For correctly.
app.set("trust proxy", 1);
// Helmet defaults already ship a CSP with `frame-ancestors 'self'`, which is the modern
// replacement for the deprecated X-Frame-Options header. We therefore disable Helmet's
// frameguard (X-Frame-Options) and rely on frame-ancestors for clickjacking protection.
app.use(helmet({ frameguard: false }));

const isDev = IS_DEV;

// Explicit allowlist: only the hosted frontend.
// In dev mode, any localhost origin is also accepted automatically.
const allowedOrigins = [
  process.env.PLATFORM_URL,       // e.g. https://socviewer.example.com
  process.env.INPUTFORM_URL,      // InputForm frontend also calls /api/auth/providers
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Same-origin / non-browser requests (curl, server-to-server) have no Origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    console.warn(`[CORS] Rejected origin: ${origin}`);
    callback(new Error(`CORS: Origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 600, // Cache preflight for 10 minutes
};

app.use(cors(corsOptions));
// Cookie parser MUST be registered before the CSRF middleware
app.use(cookieParser());
// JSON body parsing — tight default to bound memory pressure.
// Playbook import is the only legitimate large-payload endpoint; it gets a
// dedicated 100MB parser mounted directly on its route below.
const PLAYBOOK_IMPORT_BODY_LIMIT = "100mb";
const playbookImportJsonParser = express.json({ limit: PLAYBOOK_IMPORT_BODY_LIMIT });
const standardJsonParser = express.json({ limit: "1mb" });

app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth")) return next();
  // Playbook import endpoints carry the full JSON definition and need a
  // generous limit. Everything else stays at 1MB.
  if (req.path.startsWith("/api/admin/playbooks") &&
      (req.path.endsWith("/import") || req.path.endsWith("/smart-import"))) {
    return playbookImportJsonParser(req, res, next);
  }
  standardJsonParser(req, res, next);
});

// CSRF protection (double submit cookie pattern)
// Protects all POST/PUT/PATCH/DELETE requests.
// GET /api/csrf-token must be called first to obtain the token + cookie.
// Auth routes (/api/auth/*) are exempt because Better Auth ships its own CSRF checks.
app.use((req, res, next) => {
  // Exclude Better Auth routes from CSRF (they have their own mechanisms)
  if (req.path.startsWith("/api/auth")) return next();
  doubleCsrfProtection(req, res, next);
});

// CSRF token endpoint - the frontend calls this to obtain a token
app.get("/api/csrf-token", (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ csrfToken: token });
});

// Endpoint to query available SSO providers
app.get("/api/auth/providers", (req, res) => {
  res.json({ providers: getAvailableProviders() });
});

// Public health check — no auth required
app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public config endpoint — no auth required
app.get("/api/config", async (_req, res) => {
  const azureEnabled = process.env.AUTH_AZURE_ENABLED === "true";
  const azureClientId = process.env.AZURE_CLIENT_ID || null;
  res.json({
    environment: NODE_ENV,
    features: {
      authProviders: {
        azure: Boolean(process.env.OIDC_ISSUER),
        auth0: Boolean(process.env.AUTH0_OIDC_ISSUER),
      },
    },
    auth: {
      azure: {
        enabled: azureEnabled && Boolean(azureClientId),
        clientId: azureClientId,
        tenantId: process.env.AZURE_TENANT_ID || "common",
        authority: process.env.AZURE_AUTHORITY || null,
      },
      betterAuth: {
        enabled: process.env.AUTH_BETTERAUTH_ENABLED === "true",
      },
    },
  });
});

// Custom Error Page: Redirect to branded frontend error page instead of Better-Auth default
app.get("/api/auth/error", (req, res) => {
  const errorCode = req.query.error || "unknown_error";
  const frontendUrl = process.env.PLATFORM_URL || "http://localhost:5173";
  const redirectUrl = `${frontendUrl}/error?error=${encodeURIComponent(errorCode)}`;
  res.redirect(redirectUrl);
});

// Custom Auth Endpoints (MUST be before Better-Auth catch-all)
// These are needed because Better-Auth shadows /api/auth/*, preventing access to our custom session info
import { requireAuthEither } from "./lib/auth.combined.js";
import ensureAuthenticatedUser from "./routes/api/middleware/ensureAuthenticatedUser.js";
import getSession from "./routes/api/auth/getSession.js";
import getUserPreferences from "./routes/api/users/getUserPreferences.js";
import updateUserPreferences from "./routes/api/users/updateUserPreferences.js";
import verifyEmail from "./routes/api/auth/verifyEmail.js";
import resendVerification from "./routes/api/auth/resendVerification.js";

const customSessionHandler = [requireAuthEither, ensureAuthenticatedUser, getSession];

// Explicitly define these routes with app.get to ensure they match before app.all
app.get("/api/auth/me", ...customSessionHandler);
app.get("/api/auth/get-session", ...customSessionHandler);

// Preferences endpoints — must be registered before the Better-Auth catch-all below
app.get("/api/auth/preferences", requireAuthEither, ensureAuthenticatedUser, getUserPreferences);
app.put("/api/auth/preferences", express.json({ limit: "1mb" }), requireAuthEither, ensureAuthenticatedUser, updateUserPreferences);

// Email verification routes (verify-email is public — no auth required, token is the proof)
app.get("/api/auth/preferences/verify-email", verifyEmail);
app.post("/api/auth/preferences/resend-verification", authSensitiveLimiter, express.json({ limit: "1mb" }), requireAuthEither, ensureAuthenticatedUser, resendVerification);

// Brute-force protection for Better-Auth's credential endpoints: the generic
// /api rate limiter is mounted AFTER this catch-all, so without this guard
// sign-in/sign-up (incl. the demo login) would be entirely unlimited.
// Session polling (get-session) stays unthrottled on purpose.
// The path matcher lives in lib/authSensitivePaths.js (unit-tested there).
app.use((req, res, next) => {
  if (AUTH_SENSITIVE_PATHS.test(req.path)) {
    return authCredentialLimiter(req, res, next);
  }
  next();
});

// IMPORTANT: Better-Auth handler (deferred middleware)
// Revert to app.all to pass FULL path to BetterAuth (matches baseURL)
app.all(/^\/api\/auth\/.*/, (req, res, next) => {
  if (!authHandler) {
    return res.status(503).json({ error: "Service starting up, please wait..." });
  }
  return authHandler(req, res, next);
});


const morganFormat = (LOG_LEVEL === "debug" || LOG_LEVEL === "trace") ? "dev" : "combined";
app.use(morgan(morganFormat, {
  skip: (_req, res) => res.statusCode < 400 && LOG_LEVEL !== "debug" && LOG_LEVEL !== "trace"
}));

app.use("/api", apiRateLimiter, apiRouter);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  // Handle CSRF token errors explicitly
  if (err.code === "EBADCSRFTOKEN") {
    logger.warn({ path: req.path, method: req.method }, "CSRF token validation failed");
    return res.status(403).json({ error: "Invalid or missing CSRF token. Please reload the page." });
  }
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal Server Error" });
});

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: true });

    // Initialize auth only after the DB is available!
    logger.info("[Server] Connected to MongoDB. Initializing Auth...");
    const auth = initAuth();
    authHandler = toNodeHandler(auth);
    logger.info("[Server] Auth initialized.");

    app.listen(PORT, () => {
      logger.info(`API listening on http://localhost:${PORT}`);
      automationService.startPolling();
      startTicketWatcher();
      startUpdateChecker();
    });
  } catch (err) {
    logger.error(err, "Failed to start server");
    process.exit(1);
  }
})();
