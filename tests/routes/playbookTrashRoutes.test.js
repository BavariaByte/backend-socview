// Regression guard for the playbook trash feature (routes/api/admin/index.js
// + routes/api/admin/playbooks/*.js). Without this file, the three
// guarantees below rest entirely on code review:
//
//   1. Route ordering: GET /deleted must be registered before GET /:id, or
//      Express treats "deleted" as an :id and routes to getPlaybook instead
//      of listDeletedPlaybooks.
//   2. Super-admin gate: DELETE /:id/permanent must stay wired behind
//      requireSuperAdmin in the real router, not just in the middleware
//      unit tests (see requireSuperAdmin.test.js, which tests the function
//      in isolation and never touches the router).
//   3. Read-path filtering: the handlers must query with deletedAt: null
//      (or the trash-window filter for listDeletedPlaybooks) so a deleted
//      playbook stays unreachable through the normal read paths.
//
// This drives the REAL router from routes/api/admin/index.js (not a
// hand-rolled copy of the route table) through supertest, so a future
// reorder or a dropped filter in that file breaks these tests. The only
// thing swapped out is the @girp/database-models import, via node:test's
// built-in ESM module mocking (mock.module) -- no MongoDB, no network.
//
// mock.module requires the --experimental-test-module-mocks flag, which is
// why the "test" script in package.json now passes it to `node --test`.
//
// NODE_ENV is pinned before anything that transitively loads lib/env.js is
// imported (it calls process.exit(1) when NODE_ENV is unset), mirroring
// requireScope.test.js and auth.combined.test.js. The AUTH_* provider flags
// are cleared for the same reason as in auth.combined.test.js: lib/auth
// .combined.js (pulled in transitively via routes/api/admin/settings/
// getSettings.js) resolves them once at module load time.

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";
delete process.env.AUTH_AZURE_ENABLED;
delete process.env.AUTH_AUTH0_ENABLED;
delete process.env.AUTH_BETTERAUTH_ENABLED;

// Minimal stand-in for a mongoose Query: supports the chained calls the
// handlers use (.sort/.select/.lean) and resolves like a promise when
// awaited, without touching a real database.
class FakeQuery {
    constructor(result) {
        this.result = result;
    }
    sort() { return this; }
    select() { return this; }
    lean() { return this; }
    then(resolve, reject) {
        return Promise.resolve(this.result).then(resolve, reject);
    }
}

// Records every query object the handlers pass to find/findOne, so tests
// can assert on the *filter*, not just the response shape -- this is what
// catches a dropped `deletedAt: null`.
const calls = { find: [], findOne: [], deleteOne: [], deleteMany: [] };
let findResult = [];
let findOneResult = null;

const Playbook = {
    find(query) {
        calls.find.push(query);
        return new FakeQuery(findResult);
    },
    findOne(query) {
        calls.findOne.push(query);
        return new FakeQuery(findOneResult);
    },
    async deleteOne(query) {
        calls.deleteOne.push(query);
        return { acknowledged: true };
    },
};

const PlaybookVersion = {
    findOne() { return new FakeQuery(null); },
    async deleteMany(query) {
        calls.deleteMany.push(query);
        return { acknowledged: true };
    },
};

// Only Playbook/PlaybookVersion are actually exercised; the rest of these
// names just need to exist because other files reachable from
// routes/api/admin/index.js (settings, api tokens, the update checker, its
// admin-mail notifier) import them at the top level -- an ESM named import
// for a binding this mock doesn't provide is a hard SyntaxError at link
// time, even if the binding is never called.
mock.module("@girp/database-models", {
    namedExports: {
        Playbook,
        PlaybookVersion,
        Settings: {},
        ApiToken: {},
        UserModel: {},
        UserPreferences: {},
        TicketModel: {},
        FormResult: {},
        FormSession: {},
        CounterModel: {},
    },
});

// Import the real router wiring AFTER the mock is installed.
const { default: adminRouter } = await import("../../routes/api/admin/index.js");

function buildApp(sessionUser) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (sessionUser) req.sessionUser = sessionUser;
        next();
    });
    app.use("/api/admin", adminRouter);
    return app;
}

const user = (roles) => ({ _id: "user-1", e_mail: "user-1@test.local", roles });

function resetCalls() {
    calls.find.length = 0;
    calls.findOne.length = 0;
    calls.deleteOne.length = 0;
    calls.deleteMany.length = 0;
    findResult = [];
    findOneResult = null;
}

// --- 1. Route ordering: /deleted must not be swallowed by /:id ---

test("GET /api/admin/playbooks/deleted reaches the deleted-list handler, not GET /:id", async () => {
    resetCalls();
    findResult = [{ playbookId: "trashed-1", name: "Trashed One", deletedAt: new Date() }];

    const app = buildApp(user(["admin"]));
    const res = await request(app).get("/api/admin/playbooks/deleted").expect(200);

    // Only listDeletedPlaybooks produces this shape (data/total/retentionDays);
    // getPlaybook would produce { playbook, formDefinition } instead and 404
    // in this test's setup since findOneResult is null.
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data[0].playbookId, "trashed-1");
    assert.ok("retentionDays" in res.body);
    assert.equal("playbook" in res.body, false);

    // The strongest signal: Playbook.find (used by listDeletedPlaybooks) was
    // called, and Playbook.findOne (used by getPlaybook) was not. If the
    // routes were reordered so /:id is registered first, this would flip.
    assert.equal(calls.find.length, 1);
    assert.equal(calls.findOne.length, 0);
});

// --- 2. Super-admin gate, exercised through the real router ---

test("DELETE /api/admin/playbooks/:id/permanent is 403 for a plain admin", async () => {
    resetCalls();

    const app = buildApp(user(["admin"]));
    const res = await request(app).delete("/api/admin/playbooks/some-playbook/permanent").expect(403);

    assert.match(res.body.error, /super admin/i);
    // The handler must never have run -- no DB call of any kind.
    assert.equal(calls.findOne.length, 0);
    assert.equal(calls.deleteOne.length, 0);
    assert.equal(calls.deleteMany.length, 0);
});

test("DELETE /api/admin/playbooks/:id/permanent reaches the handler for admin+super_admin", async () => {
    resetCalls();
    findOneResult = { playbookId: "some-playbook", deletedAt: new Date() };

    const app = buildApp(user(["admin", "super_admin"]));
    const res = await request(app).delete("/api/admin/playbooks/some-playbook/permanent").expect(200);

    assert.equal(res.body.message, "Playbook permanently deleted");
    assert.equal(calls.findOne.length, 1);
    assert.equal(calls.deleteOne.length, 1);
    // The version snapshots must survive: tickets created from this playbook
    // still render their historical questions from them after the playbook
    // itself is gone. Deleting them here would silently break old tickets.
    assert.equal(calls.deleteMany.length, 0);
});

// --- 3. Read-path filtering: deletedAt: null must reach the query ---

test("GET /api/admin/playbooks filters with deletedAt: null", async () => {
    resetCalls();
    findResult = [];

    const app = buildApp(user(["admin"]));
    await request(app).get("/api/admin/playbooks").expect(200);

    assert.equal(calls.find.length, 1);
    assert.deepEqual(calls.find[0], { deletedAt: null });
});

test("GET /api/admin/playbooks/:id filters with deletedAt: null", async () => {
    resetCalls();
    findOneResult = null; // not found -> 404, but the filter is what we assert on

    const app = buildApp(user(["admin"]));
    await request(app).get("/api/admin/playbooks/some-playbook").expect(404);

    assert.equal(calls.findOne.length, 1);
    assert.deepEqual(calls.findOne[0], { playbookId: "some-playbook", deletedAt: null });
});
