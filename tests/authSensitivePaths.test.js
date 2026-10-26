// Tests for the credential-endpoint path matcher (lib/authSensitivePaths.js)
// that server.js uses to route Better-Auth credential requests through the
// brute-force rate limiter. The matching semantics are security-relevant in
// both directions: credential endpoints MUST be throttled, while session
// polling (get-session) must stay unthrottled.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_SENSITIVE_PATHS } from "../lib/authSensitivePaths.js";

const matches = (p) => AUTH_SENSITIVE_PATHS.test(p);

test("credential endpoints are matched", () => {
    assert.ok(matches("/api/auth/sign-in/email"));
    assert.ok(matches("/api/auth/sign-up/email"));
    assert.ok(matches("/api/auth/forget-password"));
    assert.ok(matches("/api/auth/reset-password"));
    assert.ok(matches("/api/auth/change-password"));
    assert.ok(matches("/api/auth/change-email"));
    assert.ok(matches("/api/auth/delete-user"));
});

test("session polling and other non-credential auth routes are not matched", () => {
    assert.ok(!matches("/api/auth/get-session"));
    assert.ok(!matches("/api/auth/me"));
    assert.ok(!matches("/api/auth/providers"));
    assert.ok(!matches("/api/auth/error"));
    assert.ok(!matches("/api/auth/sign-out"));
});

test("the verb must be followed by a slash or the end of the path", () => {
    assert.ok(matches("/api/auth/sign-in"));
    assert.ok(matches("/api/auth/sign-in/"));
    // Prefix look-alikes must NOT be throttled
    assert.ok(!matches("/api/auth/sign-in-foo"));
    assert.ok(!matches("/api/auth/sign-upgrade"));
});

test("paths outside /api/auth never match", () => {
    assert.ok(!matches("/api/users/sign-in"));
    assert.ok(!matches("/auth/sign-in"));
    assert.ok(!matches("/api/authx/sign-in"));
    assert.ok(!matches("/prefix/api/auth/sign-in"));
});
