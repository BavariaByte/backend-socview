import test from "node:test";
import assert from "node:assert/strict";

// lib/logger.js -> lib/env.js hard-exits when NODE_ENV is unset — the
// environment is pinned before the dynamic import below, mirroring the
// other test files in this suite (e.g. requireScope.test.js).
process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { default: requireSuperAdmin } = await import("../routes/api/middleware/requireSuperAdmin.js");

const mockRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};

test("passes a super admin through", () => {
    let called = false;
    requireSuperAdmin({ sessionUser: { roles: ["admin", "super_admin"] } }, mockRes(), () => { called = true; });
    assert.equal(called, true);
});

test("rejects a plain admin with 403", () => {
    const res = mockRes();
    let called = false;
    requireSuperAdmin({ sessionUser: { roles: ["admin"] } }, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /super admin/i);
});

test("rejects a request without a session user with 401", () => {
    const res = mockRes();
    requireSuperAdmin({}, res, () => { throw new Error("must not continue"); });
    assert.equal(res.statusCode, 401);
});
