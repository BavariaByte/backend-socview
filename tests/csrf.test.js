// Tests for the CSRF double-submit middleware (lib/csrf.js) as wired in
// server.js: cookie-parser -> doubleCsrfProtection -> routes -> error handler
// mapping EBADCSRFTOKEN to a 403 JSON response. The mini-app below mirrors
// that wiring without booting server.js (which would connect to MongoDB).
//
// lib/csrf.js transitively imports lib/env.js, which hard-exits when NODE_ENV
// is unset — the environment is pinned before the dynamic import.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { doubleCsrfProtection, generateCsrfToken } = await import("../lib/csrf.js");

function buildApp() {
    const app = express();
    const state = { handlerRan: false };

    app.use(cookieParser());
    app.use(doubleCsrfProtection);

    // Mirrors GET /api/csrf-token in server.js
    app.get("/api/csrf-token", (req, res) => {
        const token = generateCsrfToken(req, res);
        res.json({ csrfToken: token });
    });

    app.get("/api/data", (_req, res) => res.json({ ok: true }));
    app.post("/api/data", (_req, res) => {
        state.handlerRan = true;
        res.json({ created: true });
    });

    // Mirrors the error handler in server.js
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (err.code === "EBADCSRFTOKEN") {
            return res.status(403).json({ error: "Invalid or missing CSRF token. Please reload the page." });
        }
        res.status(500).json({ error: "Internal Server Error" });
    });

    return { app, state };
}

// Fetches a token + cookie pair, optionally under a given session cookie.
async function issueToken(app, sessionCookie) {
    const req = request(app).get("/api/csrf-token");
    if (sessionCookie) req.set("Cookie", sessionCookie);
    const res = await req.expect(200);
    return res.body.csrfToken;
}

test("GET /api/csrf-token issues a token and sets the __csrf cookie", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/csrf-token").expect(200);

    // Token format: <hmac hex>.<random hex>
    assert.match(res.body.csrfToken, /^[0-9a-f]{64}\.[0-9a-f]{64}$/);

    const csrfCookie = (res.headers["set-cookie"] || []).find((c) => c.startsWith("__csrf="));
    assert.ok(csrfCookie, "expected a __csrf Set-Cookie header");
    assert.equal(csrfCookie.split(";")[0], `__csrf=${res.body.csrfToken}`);
    assert.match(csrfCookie, /HttpOnly/i);
    assert.match(csrfCookie, /SameSite=Lax/i);
});

test("GET requests are exempt from CSRF protection", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/data").expect(200);
    assert.deepEqual(res.body, { ok: true });
});

test("state-changing POST without token and cookie is rejected with 403", async () => {
    const { app, state } = buildApp();
    const res = await request(app).post("/api/data").expect(403);
    assert.match(res.body.error, /CSRF token/);
    assert.equal(state.handlerRan, false, "handler must not run on CSRF failure");
});

test("POST with only one half of the double submit is rejected", async () => {
    const { app, state } = buildApp();
    const token = await issueToken(app);

    // Header token without the cookie
    await request(app)
        .post("/api/data")
        .set("x-csrf-token", token)
        .expect(403);

    // Cookie without the header token
    await request(app)
        .post("/api/data")
        .set("Cookie", `__csrf=${token}`)
        .expect(403);

    assert.equal(state.handlerRan, false, "handler must not run on CSRF failure");
});

test("POST with matching cookie and header token passes", async () => {
    const { app, state } = buildApp();
    const token = await issueToken(app);

    const res = await request(app)
        .post("/api/data")
        .set("Cookie", `__csrf=${token}`)
        .set("x-csrf-token", token)
        .expect(200);

    assert.deepEqual(res.body, { created: true });
    assert.equal(state.handlerRan, true);
});

test("tampered token is rejected even when cookie and header match", async () => {
    const { app, state } = buildApp();
    const token = await issueToken(app);

    // Flip the last hex digit of the random value — cookie and header still
    // match each other, but the HMAC no longer covers the random value.
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");

    await request(app)
        .post("/api/data")
        .set("Cookie", `__csrf=${tampered}`)
        .set("x-csrf-token", tampered)
        .expect(403);

    assert.equal(state.handlerRan, false);
});

test("token issued for one session is rejected under another session", async () => {
    const { app, state } = buildApp();

    // The token is HMAC-bound to the Better Auth session cookie
    // (getSessionIdentifier in lib/csrf.js).
    const token = await issueToken(app, "better-auth.session_token=session-a");

    // Same token + cookie pair replayed with a different session -> 403
    await request(app)
        .post("/api/data")
        .set("Cookie", [`__csrf=${token}`, "better-auth.session_token=session-b"])
        .set("x-csrf-token", token)
        .expect(403);
    assert.equal(state.handlerRan, false);

    // Sanity check: the original session accepts the token
    await request(app)
        .post("/api/data")
        .set("Cookie", [`__csrf=${token}`, "better-auth.session_token=session-a"])
        .set("x-csrf-token", token)
        .expect(200);
    assert.equal(state.handlerRan, true);
});
