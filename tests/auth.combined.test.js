// Tests for the combined auth entry point (lib/auth.combined.js).
//
// Covered without a database: the credential-less / malformed-bearer /
// unknown-issuer rejection paths and the re-exported bearer-scope guard.
// NOT covered here (requires MongoDB and a running Better Auth instance):
// the "soc_..." API token lookup (ApiToken.findOne) and the Better Auth
// session validation — both would buffer on a disconnected mongoose.
//
// All provider flags are cleared before the dynamic import because the
// module resolves them once at load time.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";
delete process.env.AUTH_AZURE_ENABLED;
delete process.env.AUTH_AUTH0_ENABLED;
delete process.env.AUTH_BETTERAUTH_ENABLED;

const { requireAuthEither, requireScope } = await import("../lib/auth.combined.js");

function buildApp() {
    const app = express();
    const state = { handlerRan: false };

    app.get("/guarded", requireAuthEither, (_req, res) => {
        state.handlerRan = true;
        res.json({ ok: true });
    });

    return { app, state };
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

test("request without any credentials is rejected with a generic 401", async () => {
    const { app, state } = buildApp();
    const res = await request(app).get("/guarded").expect(401);
    // Exact match: the body must not leak provider details or stack traces.
    assert.deepEqual(res.body, { error: "Missing Bearer token, session cookie or API token" });
    assert.equal(state.handlerRan, false);
});

test("non-Bearer Authorization header is treated as missing credentials", async () => {
    const { app, state } = buildApp();
    const res = await request(app)
        .get("/guarded")
        .set("Authorization", "Basic dXNlcjpwYXNzd29yZA==")
        .expect(401);
    assert.deepEqual(res.body, { error: "Missing Bearer token, session cookie or API token" });
    assert.equal(state.handlerRan, false);
});

test("malformed bearer token is rejected with 401", async () => {
    const { app, state } = buildApp();
    const res = await request(app)
        .get("/guarded")
        .set("Authorization", "Bearer not-a-jwt")
        .expect(401);
    assert.deepEqual(res.body, { error: "Invalid JWT format" });
    assert.equal(state.handlerRan, false);
});

test("well-formed JWT from an unknown issuer is rejected with 401", async () => {
    const { app, state } = buildApp();
    // Structurally valid (unsigned) JWT — decodeJwt only decodes, so this
    // exercises the issuer routing, not signature verification.
    const token = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ iss: "https://evil.example.com/" })}.sig`;

    const res = await request(app)
        .get("/guarded")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    assert.equal(res.body.error, "Unexpected issuer or provider not enabled");
    assert.equal(state.handlerRan, false);
});

test("re-exported requireScope guards bearer-token scopes on req.user", async () => {
    // lib/auth.combined.js re-exports the JWT-scope guard from lib/auth.azure.js;
    // it reads req.user.scope (set by the Azure/Auth0 middlewares).
    const buildScopedApp = (scopes) => {
        const app = express();
        app.get(
            "/guarded",
            (req, _res, next) => {
                req.user = { scope: scopes };
                next();
            },
            requireScope("tickets:read"),
            (_req, res) => res.json({ ok: true })
        );
        return app;
    };

    await request(buildScopedApp(["tickets:read"])).get("/guarded").expect(200);

    const denied = await request(buildScopedApp(["forms:read"])).get("/guarded").expect(403);
    assert.equal(denied.body.error, "Insufficient scope");
});
