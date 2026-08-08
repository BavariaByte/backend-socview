import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const runWithEnv = (env, code) => {
    return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, NODE_ENV: "", DEMO_MODE: "", AUTH_EMAIL_PASSWORD_ENABLED: "", ...env },
        encoding: "utf8"
    });
};

const IMPORT_ONLY = "await import('./lib/env.js'); process.exit(0);";
const IMPORT_AND_VALIDATE =
    "const m = await import('./lib/env.js'); m.validateEnvOrExit(); process.exit(0);";

test("startup aborts when NODE_ENV is unset", () => {
    const result = runWithEnv({ NODE_ENV: "" }, IMPORT_ONLY);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NODE_ENV is not set/);
});

test("startup aborts on an unrecognized NODE_ENV", () => {
    const result = runWithEnv({ NODE_ENV: "staging" }, IMPORT_ONLY);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not recognized/);
});

test("development and production are accepted", () => {
    assert.equal(runWithEnv({ NODE_ENV: "development" }, IMPORT_ONLY).status, 0);
    assert.equal(runWithEnv({ NODE_ENV: "production" }, IMPORT_ONLY).status, 0);
});

// The hosted demo runs with NODE_ENV=production on purpose: development mode
// would give a publicly reachable site the dev conveniences (auto-admin for
// role-less users, non-secure cookies).
test("DEMO_MODE is allowed in production but warns loudly", () => {
    const result = runWithEnv(
        { NODE_ENV: "production", DEMO_MODE: "true", AUTH_EMAIL_PASSWORD_ENABLED: "true" },
        IMPORT_AND_VALIDATE
    );
    assert.equal(result.status, 0);
    assert.match(result.stderr, /WARNING: DEMO_MODE=true with NODE_ENV=production/);
});

test("AUTH_EMAIL_PASSWORD_ENABLED without DEMO_MODE still aborts in production", () => {
    const result = runWithEnv(
        { NODE_ENV: "production", AUTH_EMAIL_PASSWORD_ENABLED: "true" },
        IMPORT_AND_VALIDATE
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AUTH_EMAIL_PASSWORD_ENABLED/);
});

test("demo flags are allowed in development (Launcher)", () => {
    const result = runWithEnv(
        { NODE_ENV: "development", DEMO_MODE: "true", AUTH_EMAIL_PASSWORD_ENABLED: "true" },
        IMPORT_AND_VALIDATE
    );
    assert.equal(result.status, 0);
});
