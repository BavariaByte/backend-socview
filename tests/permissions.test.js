import test from "node:test";
import assert from "node:assert/strict";
import { SCOPES, getUserScopes } from "../lib/permissions.js";

test("admin role grants the wildcard scope", () => {
    assert.deepEqual(getUserScopes(["admin"]), ["*"]);
});

test("user role grants the expected scopes", () => {
    const scopes = getUserScopes(["user"]);
    assert.ok(scopes.includes(SCOPES.TICKET_READ));
    assert.ok(scopes.includes(SCOPES.TICKET_CREATE));
    assert.ok(scopes.includes(SCOPES.FORM_SUBMIT));
    assert.ok(!scopes.includes(SCOPES.ADMIN_ACCESS));
    assert.ok(!scopes.includes(SCOPES.PLAYBOOK_MANAGE));
});

test("playbook_manager can manage playbooks but not users", () => {
    const scopes = getUserScopes(["playbook_manager"]);
    assert.ok(scopes.includes(SCOPES.PLAYBOOK_MANAGE));
    assert.ok(!scopes.includes(SCOPES.USER_MANAGE));
});

test("pending and deactivated roles grant nothing", () => {
    assert.deepEqual(getUserScopes(["pending"]), []);
    assert.deepEqual(getUserScopes(["deactivated"]), []);
});

test("roles are matched case-insensitively and deduplicated", () => {
    const scopes = getUserScopes(["Admin", "ADMIN"]);
    assert.deepEqual(scopes, ["*"]);
});

test("invalid input returns an empty scope list", () => {
    assert.deepEqual(getUserScopes(null), []);
    assert.deepEqual(getUserScopes("admin"), []);
});
