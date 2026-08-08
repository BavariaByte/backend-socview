// Tests for the pre-database gates of ensureAuthenticatedUser
// (routes/api/middleware/ensureAuthenticatedUser.js).
//
// Only the paths that return BEFORE any MongoDB access are covered here:
// missing authentication (401) and an underivable identity (400).
// The user lookup/creation, role backfill and the pending/deactivated
// 403 gates all require a connected mongoose (UserModel/Settings queries
// would buffer forever on a disconnected instance) and are therefore out
// of scope for this offline suite.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { default: ensureAuthenticatedUser } =
    await import("../routes/api/middleware/ensureAuthenticatedUser.js");

function buildApp(stubUser) {
    const app = express();
    const state = { handlerRan: false };

    app.get(
        "/guarded",
        (req, _res, next) => {
            if (stubUser) req.user = stubUser;
            next();
        },
        ensureAuthenticatedUser,
        (_req, res) => {
            state.handlerRan = true;
            res.json({ ok: true });
        }
    );

    return { app, state };
}

test("request without req.user is rejected with 401", async () => {
    const { app, state } = buildApp(null);
    const res = await request(app).get("/guarded").expect(401);
    assert.deepEqual(res.body, { error: "Authentication required" });
    assert.equal(state.handlerRan, false);
});

test("token without a derivable identity is rejected with 400", async () => {
    // Authenticated, but the token carries neither email nor a subject id.
    const { app, state } = buildApp({ payload: {} });
    const res = await request(app).get("/guarded").expect(400);
    assert.deepEqual(res.body, { error: "Unable to derive user identity from token" });
    assert.equal(state.handlerRan, false);
});
