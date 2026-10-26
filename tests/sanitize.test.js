// Lightweight unit tests for the security helpers in middleware/sanitize.js.
// Run via:  npm test
//
// These tests cover the regression-critical helpers introduced/used by PR-2
// and PR-3 (escapeHtml, escapeRegex, stripMongoOperators, sanitizeString).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    sanitizeString,
    stripMongoOperators,
    isValidObjectId,
    escapeRegex,
    escapeHtml,
} from "../routes/api/middleware/sanitize.js";

test("sanitizeString strips HTML tags and null bytes", () => {
    assert.equal(sanitizeString("<script>alert(1)</script>hi"), "alert(1)hi");
    assert.equal(sanitizeString("a\0b"), "ab");
    assert.equal(sanitizeString(null), "");
    assert.equal(sanitizeString(undefined), "");
});

test("sanitizeString enforces max length", () => {
    const long = "a".repeat(20_000);
    assert.equal(sanitizeString(long).length, 10_000);
});

test("stripMongoOperators removes $-prefixed keys recursively", () => {
    const obj = {
        userid: "alice",
        e_mail: { $ne: null },
        nested: {
            $regex: "^.*$",
            ok: 1,
            arr: [{ $gt: 1 }, { keep: 2 }],
        },
    };
    stripMongoOperators(obj);
    assert.deepEqual(obj, {
        userid: "alice",
        e_mail: {},
        nested: {
            ok: 1,
            arr: [{}, { keep: 2 }],
        },
    });
});

test("isValidObjectId only accepts 24-hex strings", () => {
    assert.equal(isValidObjectId("507f1f77bcf86cd799439011"), true);
    assert.equal(isValidObjectId("not-an-id"), false);
    assert.equal(isValidObjectId(""), false);
    assert.equal(isValidObjectId(null), false);
    assert.equal(isValidObjectId({ $ne: null }), false);
});

test("escapeRegex escapes regex meta-characters", () => {
    // Regex-Injection: the dot should not match arbitrary chars after escape.
    const escaped = escapeRegex("alice.bob+test@example.com");
    const re = new RegExp(`^${escaped}$`, "i");
    assert.equal(re.test("alice.bob+test@example.com"), true);
    // The unescaped `.` would match any char — the escaped version must not.
    assert.equal(re.test("aliceXbob+test@example.com"), false);
});

test("escapeRegex rejects non-strings safely", () => {
    assert.equal(escapeRegex(undefined), "");
    assert.equal(escapeRegex(null), "");
    assert.equal(escapeRegex(123), "123");
});

test("escapeHtml escapes the five XML-significant characters", () => {
    assert.equal(
        escapeHtml(`<img src=x onerror="alert(1)">'&"`),
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;&quot;",
    );
    assert.equal(escapeHtml(null), "");
});
