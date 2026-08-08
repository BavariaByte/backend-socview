// Tests for the scope guard used by the /api router
// (routes/api/middleware/requireScope.js). The guard consumes
// req.sessionUser (set by ensureAuthenticatedUser and augmented by
// augmentEffectiveRoles), so tests stub exactly that seam — no database
// is needed for role -> scope resolution (lib/permissions.js is pure).

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { requireScope } = await import("../routes/api/middleware/requireScope.js");
const { SCOPES } = await import("../lib/permissions.js");

// Mini-app mirroring the /api router: stub sessionUser -> requireScope -> handler.
function buildApp(requiredScope, sessionUser) {
    const app = express();
    const state = { handlerRan: false };

    app.get(
        "/guarded",
        (req, _res, next) => {
            if (sessionUser) req.sessionUser = sessionUser;
            next();
        },
        requireScope(requiredScope),
        (_req, res) => {
            state.handlerRan = true;
            res.json({ ok: true });
        }
    );

    return { app, state };
}

const user = (fields) => ({ _id: "user-1", e_mail: "user-1@test.local", ...fields });

test("request without a session user is rejected with 401", async () => {
    const { app, state } = buildApp(SCOPES.TICKET_READ, null);
    const res = await request(app).get("/guarded").expect(401);
    assert.deepEqual(res.body, { error: "Unauthorized - No session user found" });
    assert.equal(state.handlerRan, false);
});

test("role granting the required scope passes through to the handler", async () => {
    const { app, state } = buildApp(SCOPES.TICKET_READ, user({ roles: ["user"] }));
    const res = await request(app).get("/guarded").expect(200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(state.handlerRan, true);
});

test("missing scope yields 403 and the handler never runs", async () => {
    const { app, state } = buildApp(SCOPES.ADMIN_ACCESS, user({ roles: ["user"] }));
    const res = await request(app).get("/guarded").expect(403);
    assert.equal(res.body.error, `Missing permission: ${SCOPES.ADMIN_ACCESS}`);
    assert.equal(state.handlerRan, false);
});

test("admin wildcard grants any scope", async () => {
    const { app, state } = buildApp(SCOPES.USER_MANAGE, user({ roles: ["admin"] }));
    await request(app).get("/guarded").expect(200);
    assert.equal(state.handlerRan, true);
});

test("virtual roles from augmentEffectiveRoles are honored", async () => {
    // Empty DB roles, virtual playbook_manager role -> playbooks:manage allowed
    const manager = user({ roles: [], virtualRoles: ["playbook_manager"] });
    const allowed = buildApp(SCOPES.PLAYBOOK_MANAGE, manager);
    await request(allowed.app).get("/guarded").expect(200);
    assert.equal(allowed.state.handlerRan, true);

    // ...but not scopes outside the role
    const denied = buildApp(SCOPES.USER_MANAGE, manager);
    await request(denied.app).get("/guarded").expect(403);
    assert.equal(denied.state.handlerRan, false);
});

test("API token scopes grant access, including resource wildcards", async () => {
    // Direct scope from an API token (no roles at all)
    const direct = buildApp(
        SCOPES.TICKET_READ,
        user({ roles: [], apiTokenScopes: [SCOPES.TICKET_READ] })
    );
    await request(direct.app).get("/guarded").expect(200);
    assert.equal(direct.state.handlerRan, true);

    // Resource wildcard: "tickets:*" covers "tickets:delete"
    const wildcard = buildApp(
        SCOPES.TICKET_DELETE,
        user({ roles: [], apiTokenScopes: ["tickets:*"] })
    );
    await request(wildcard.app).get("/guarded").expect(200);
    assert.equal(wildcard.state.handlerRan, true);

    // A token scoped to another resource stays locked out
    const denied = buildApp(
        SCOPES.TICKET_READ,
        user({ roles: [], apiTokenScopes: [SCOPES.FORM_READ] })
    );
    await request(denied.app).get("/guarded").expect(403);
    assert.equal(denied.state.handlerRan, false);
});
