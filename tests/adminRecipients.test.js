// adminRecipients.js transitively imports lib/logger.js -> lib/env.js, which
// hard-exits when NODE_ENV is unset — the environment is pinned before the
// dynamic import, mirroring the pattern in tests/csrf.test.js.

import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { resolveAdminRecipients } = await import("../services/notifications/adminRecipients.js");
const { normalizeLang } = await import("../services/notifications/adminMail.js");

// Minimal stand-ins for the mongoose models — no database involved.
const makeDeps = ({ users = [], prefs = [], superAdminEmail = null, adminEmails = [] } = {}) => ({
    superAdminEmail,
    SettingsImpl: {
        findOne: async () => ({ key: "admin_emails", value: adminEmails })
    },
    UserPreferencesImpl: {
        find: async () => prefs
    },
    UserModelImpl: {
        find: async (query) => {
            const ids = query?.userid?.$in;
            return ids ? users.filter(u => ids.includes(u.userid)) : users;
        }
    }
});

const adminPrefs = (userId, extra = {}) => ({
    userId,
    timezone: "Europe/Berlin",
    language: "de",
    notifications: { email: { enabled: true, useLoginEmail: true, ...extra } }
});

test("the super admin address is always included", async () => {
    const recipients = await resolveAdminRecipients(makeDeps({ superAdminEmail: "boss@example.com" }));
    assert.deepEqual(recipients.map(r => r.email), ["boss@example.com"]);
});

test("admins with enabled notifications are included with their login email", async () => {
    const deps = makeDeps({
        prefs: [adminPrefs("u1")],
        users: [{ userid: "u1", e_mail: "admin@example.com", roles: ["admin"] }]
    });
    const recipients = await resolveAdminRecipients(deps);
    assert.deepEqual(recipients.map(r => r.email), ["admin@example.com"]);
    assert.equal(recipients[0].language, "de");
});

test("non-admins are ignored even with notifications enabled", async () => {
    const deps = makeDeps({
        prefs: [adminPrefs("u2")],
        users: [{ userid: "u2", e_mail: "user@example.com", roles: ["user"] }]
    });
    assert.deepEqual(await resolveAdminRecipients(deps), []);
});

test("an unverified custom email is skipped", async () => {
    const deps = makeDeps({
        prefs: [adminPrefs("u3", { useLoginEmail: false, customEmail: "priv@example.com", customEmailVerified: false })],
        users: [{ userid: "u3", e_mail: "admin3@example.com", roles: ["admin"] }]
    });
    assert.deepEqual(await resolveAdminRecipients(deps), []);
});

test("a verified custom email replaces the login email", async () => {
    const deps = makeDeps({
        prefs: [adminPrefs("u4", { useLoginEmail: false, customEmail: "priv@example.com", customEmailVerified: true })],
        users: [{ userid: "u4", e_mail: "admin4@example.com", roles: ["super_admin"] }]
    });
    const recipients = await resolveAdminRecipients(deps);
    assert.deepEqual(recipients.map(r => r.email), ["priv@example.com"]);
});

test("duplicates are removed case-insensitively", async () => {
    const deps = makeDeps({
        superAdminEmail: "Boss@Example.com",
        prefs: [adminPrefs("u5")],
        users: [{ userid: "u5", e_mail: "boss@example.com", roles: ["admin"] }]
    });
    assert.equal((await resolveAdminRecipients(deps)).length, 1);
});

test("a database failure does not drop the super admin recipient", async () => {
    const deps = {
        superAdminEmail: "boss@example.com",
        SettingsImpl: {
            findOne: async () => {
                throw new Error("connection lost");
            }
        },
        UserPreferencesImpl: {
            find: async () => {
                throw new Error("connection lost");
            }
        },
        UserModelImpl: {
            find: async () => {
                throw new Error("connection lost");
            }
        }
    };
    const recipients = await resolveAdminRecipients(deps);
    assert.deepEqual(recipients.map(r => r.email), ["boss@example.com"]);
});

test("an opted-in admin matching the super admin address keeps their own preferences", async () => {
    const deps = makeDeps({
        superAdminEmail: "boss@example.com",
        prefs: [{
            userId: "u6",
            timezone: "America/New_York",
            language: "en",
            notifications: { email: { enabled: true, useLoginEmail: true } }
        }],
        users: [{ userid: "u6", e_mail: "boss@example.com", roles: ["super_admin"] }]
    });
    const recipients = await resolveAdminRecipients(deps);
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].email, "boss@example.com");
    assert.equal(recipients[0].timezone, "America/New_York");
    assert.equal(recipients[0].language, "en");
});

test("language preferences map onto the two mail variants", () => {
    assert.equal(normalizeLang("de"), "de");
    assert.equal(normalizeLang("de-DE"), "de");
    assert.equal(normalizeLang("en"), "en");
    assert.equal(normalizeLang("en-US"), "en");
    assert.equal(normalizeLang(undefined), "de");
});

test("an opted-in user on the admin_emails whitelist counts as an admin", async () => {
    const deps = makeDeps({
        adminEmails: ["Whitelisted@example.com"],
        prefs: [adminPrefs("u9")],
        // Role is only "user": the whitelist is what makes them an admin.
        users: [{ userid: "u9", e_mail: "whitelisted@example.com", roles: ["user"] }]
    });
    const recipients = await resolveAdminRecipients(deps);
    assert.deepEqual(recipients.map(r => r.email), ["whitelisted@example.com"]);
});

test("a non-admin who is not whitelisted is still excluded", async () => {
    const deps = makeDeps({
        adminEmails: ["someone-else@example.com"],
        prefs: [adminPrefs("u10")],
        users: [{ userid: "u10", e_mail: "plain@example.com", roles: ["user"] }]
    });
    assert.deepEqual(await resolveAdminRecipients(deps), []);
});
