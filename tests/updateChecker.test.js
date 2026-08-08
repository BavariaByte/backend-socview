// updateChecker.js imports lib/logger.js -> lib/env.js (transitively, via
// registryClient.js and adminMail.js), which hard-exits when NODE_ENV is
// unset — the environment is pinned before the dynamic import, mirroring the
// pattern in tests/registryClient.test.js.

import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { runUpdateCheck, getUpdateConfig } = await import("../services/updateChecker.js");

const baseConfig = {
    enabled: true,
    registry: "registry.example.com",
    images: ["backend-socview", "frontend-socview"],
    tag: "latest",
    intervalDays: 3,
    docsUrl: "https://docs.example.com/update",
    currentVersion: "1.0.0"
};

const makeDeps = (overrides = {}) => {
    const store = { state: null };
    const mails = [];
    return {
        mails,
        store,
        deps: {
            config: baseConfig,
            fetchLabel: async () => "1.1.0",
            loadState: async () => store.state,
            saveState: async (next) => { store.state = next; },
            sendMail: async (content) => { mails.push(content); },
            now: () => new Date("2026-07-31T08:00:00.000Z"),
            ...overrides
        }
    };
};

test("a newer registry version is recorded and mailed once", async () => {
    const { deps, mails, store } = makeDeps();

    const state = await runUpdateCheck(deps);
    assert.equal(state.latestVersion, "1.1.0");
    assert.equal(state.currentVersion, "1.0.0");
    assert.equal(state.notifiedVersion, "1.1.0");
    assert.equal(mails.length, 1);
    assert.match(mails[0].de.subject, /1\.1\.0/);
    assert.match(mails[0].de.text, /docker compose pull/);
    assert.match(mails[0].en.text, /docker compose up -d/);

    // Second run finds the same version — must stay silent.
    await runUpdateCheck(deps);
    assert.equal(mails.length, 1);
    assert.equal(store.state.notifiedVersion, "1.1.0");
});

test("no mail when the registry version equals or trails the running version", async () => {
    const { deps, mails } = makeDeps({ fetchLabel: async () => "1.0.0" });
    const state = await runUpdateCheck(deps);
    assert.equal(state.latestVersion, "1.0.0");
    assert.equal(state.notifiedVersion, null);
    assert.equal(mails.length, 0);
});

test("missing labels are tolerated and reported per image", async () => {
    const { deps, mails } = makeDeps({ fetchLabel: async (registry, image) => image === "backend-socview" ? null : null });
    const state = await runUpdateCheck(deps);
    assert.equal(state.latestVersion, null);
    assert.deepEqual(state.images, [
        { image: "backend-socview", version: null },
        { image: "frontend-socview", version: null }
    ]);
    assert.equal(mails.length, 0);
    // A check that learned nothing must be distinguishable from "up to date".
    assert.equal(state.labelsFound, 0);
    assert.match(state.lastError, /version label/);
});

test("a check that found labels reports how many, with no error", async () => {
    const { deps } = makeDeps();
    const state = await runUpdateCheck(deps);
    assert.equal(state.labelsFound, 2);
    assert.equal(state.lastError, null);
});

test("a failing image lookup does not abort the other images", async () => {
    const { deps } = makeDeps({
        fetchLabel: async (registry, image) => {
            if (image === "backend-socview") throw new Error("boom");
            return "1.2.0";
        }
    });
    const state = await runUpdateCheck(deps);
    assert.equal(state.latestVersion, "1.2.0");
    assert.match(state.lastError, /backend-socview/);
});

test("a disabled check returns the stored state untouched", async () => {
    const { deps, mails, store } = makeDeps({ config: { ...baseConfig, enabled: false } });
    // Seed a distinguishable prior state: returning a fresh empty state instead of
    // the stored one must fail this test, not slip through because both are empty.
    const stored = {
        currentVersion: "1.0.0",
        latestVersion: "1.2.0",
        checkedAt: "2026-07-01T00:00:00.000Z",
        notifiedVersion: "1.2.0",
        images: [{ image: "backend-socview", version: "1.2.0" }],
        lastError: null
    };
    store.state = stored;

    const state = await runUpdateCheck(deps);
    assert.deepEqual(state, stored);
    assert.equal(store.state, stored, "a disabled check must not write state");
    assert.equal(mails.length, 0);
});

test("getUpdateConfig applies documented defaults and clamps the interval", () => {
    const env = {
        UPDATE_CHECK_INTERVAL_DAYS: "999",
        GIRP_VERSION: "9.9.9"
    };
    const config = getUpdateConfig(env);
    assert.equal(config.enabled, true);
    assert.equal(config.registry, "docker.bavariabyte.com");
    assert.equal(config.tag, "latest");
    assert.equal(config.intervalDays, 30);
    assert.equal(config.currentVersion, "9.9.9");
    assert.deepEqual(config.images, [
        "backend-socview", "frontend-socview", "backend-inputform", "frontend-inputform"
    ]);
    assert.equal(getUpdateConfig({ UPDATE_CHECK_ENABLED: "false" }).enabled, false);
    assert.equal(getUpdateConfig({ UPDATE_CHECK_INTERVAL_DAYS: "abc" }).intervalDays, 3);
});

test("the per-request timeout budget is handed to the label lookup", async () => {
    const seen = [];
    const { deps } = makeDeps({
        config: { ...baseConfig, requestTimeoutMs: 2500 },
        fetchLabel: async (registry, image, tag, timeoutMs) => {
            seen.push(timeoutMs);
            return "1.1.0";
        }
    });
    await runUpdateCheck(deps);
    // Without it, a slow registry could outrun the client request timeout.
    assert.deepEqual(seen, [2500, 2500]);
});
