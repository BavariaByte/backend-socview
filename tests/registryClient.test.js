// registryClient.js imports lib/logger.js -> lib/env.js, which hard-exits
// when NODE_ENV is unset — the environment is pinned before the dynamic
// import, mirroring the pattern in tests/adminRecipients.test.js.

import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.LOG_LEVEL = "silent";

const { fetchImageVersionLabel } = await import("../lib/registryClient.js");

const jsonResponse = (body, { status = 200, headers = {} } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body)
});

const INDEX = {
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
        { digest: "sha256:attest", platform: { architecture: "unknown", os: "unknown" } },
        { digest: "sha256:amd64", platform: { architecture: "amd64", os: "linux" } }
    ]
};
const MANIFEST = { mediaType: "application/vnd.oci.image.manifest.v1+json", config: { digest: "sha256:cfg" } };
const CONFIG = (labels) => ({ config: { Labels: labels } });

const routerFetch = (routes, calls = []) => async (url, options) => {
    calls.push({ url, options });
    const match = Object.keys(routes).find(key => url.includes(key));
    if (!match) throw new Error(`unexpected request: ${url}`);
    return routes[match];
};

test("reads the version label from the amd64 image config", async () => {
    const calls = [];
    const fetchImpl = routerFetch({
        "/manifests/latest": jsonResponse(INDEX),
        "/manifests/sha256:amd64": jsonResponse(MANIFEST),
        "/blobs/sha256:cfg": jsonResponse(CONFIG({ "org.opencontainers.image.version": "1.1.0" }))
    }, calls);

    const version = await fetchImageVersionLabel("registry.example.com", "backend-socview", "latest", { fetchImpl });
    assert.equal(version, "1.1.0");
    assert.ok(calls[0].url.startsWith("https://registry.example.com/v2/backend-socview/manifests/latest"));
});

test("returns null when the image carries no version label", async () => {
    const fetchImpl = routerFetch({
        "/manifests/latest": jsonResponse(INDEX),
        "/manifests/sha256:amd64": jsonResponse(MANIFEST),
        "/blobs/sha256:cfg": jsonResponse(CONFIG(null))
    });
    assert.equal(await fetchImageVersionLabel("registry.example.com", "img", "latest", { fetchImpl }), null);
});

test("retries once with an anonymous bearer token on 401", async () => {
    const calls = [];
    let manifestCalls = 0;
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (url.includes("/v2/token")) return jsonResponse({ token: "tok123" });
        if (url.includes("/manifests/latest")) {
            manifestCalls += 1;
            if (manifestCalls === 1) {
                return jsonResponse({}, {
                    status: 401,
                    headers: { "www-authenticate": 'Bearer realm="https://registry.example.com/v2/token",service="reg"' }
                });
            }
            return jsonResponse(INDEX);
        }
        if (url.includes("/manifests/sha256:amd64")) return jsonResponse(MANIFEST);
        return jsonResponse(CONFIG({ "org.opencontainers.image.version": "2.0.0" }));
    };

    assert.equal(await fetchImageVersionLabel("registry.example.com", "img", "latest", { fetchImpl }), "2.0.0");
    assert.ok(calls.some(c => c.options?.headers?.Authorization === "Bearer tok123"));
});

test("returns null for an unreachable registry instead of throwing", async () => {
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    assert.equal(await fetchImageVersionLabel("registry.example.com", "img", "latest", { fetchImpl }), null);
});

// These malformed-input tests count fetchImpl invocations rather than merely
// asserting a thrown error is swallowed to null. `request()` catches any
// fetchImpl error and also returns null, so a fetchImpl that throws cannot
// distinguish "validation rejected the input before any request" from
// "a request was attempted and its exception was swallowed". Asserting
// callCount === 0 closes that gap: if validation regressed and let a
// request through, callCount would become 1 and the test would fail even
// though the final result is still null.
test("rejects a non-https registry host without issuing any request", async () => {
    let callCount = 0;
    const fetchImpl = async () => { callCount += 1; throw new Error("must not be called"); };
    const result = await fetchImageVersionLabel("http://evil.example.com", "img", "latest", { fetchImpl });
    assert.equal(result, null);
    assert.equal(callCount, 0);
});

test("rejects an image name containing a '..' path segment without issuing any request", async () => {
    let callCount = 0;
    const fetchImpl = async () => { callCount += 1; throw new Error("must not be called"); };
    const result = await fetchImageVersionLabel("registry.example.com", "a/../../secret", "latest", { fetchImpl });
    assert.equal(result, null);
    assert.equal(callCount, 0);
});

test("rejects an image name containing an empty path segment without issuing any request", async () => {
    let callCount = 0;
    const fetchImpl = async () => { callCount += 1; throw new Error("must not be called"); };
    const result = await fetchImageVersionLabel("registry.example.com", "a//b", "latest", { fetchImpl });
    assert.equal(result, null);
    assert.equal(callCount, 0);
});

test("rejects an image name containing an uppercase letter without issuing any request", async () => {
    let callCount = 0;
    const fetchImpl = async () => { callCount += 1; throw new Error("must not be called"); };
    const result = await fetchImageVersionLabel("registry.example.com", "Backend-Socview", "latest", { fetchImpl });
    assert.equal(result, null);
    assert.equal(callCount, 0);
});

test("accepts a legitimate namespaced image name", async () => {
    const calls = [];
    const fetchImpl = routerFetch({
        "/manifests/latest": jsonResponse(INDEX),
        "/manifests/sha256:amd64": jsonResponse(MANIFEST),
        "/blobs/sha256:cfg": jsonResponse(CONFIG({ "org.opencontainers.image.version": "3.0.0" }))
    }, calls);

    const version = await fetchImageVersionLabel("registry.example.com", "girp/backend-socview", "latest", { fetchImpl });
    assert.equal(version, "3.0.0");
    assert.ok(calls.length > 0);
    assert.ok(calls[0].url.startsWith("https://registry.example.com/v2/girp/backend-socview/manifests/latest"));
});

// A fetchImpl that never settles by itself, and only resolves/rejects once
// its AbortSignal fires. This is what makes the timeout tests below genuine:
// if the AbortController were never armed (e.g. a regression that passes a
// signal but forgets to call setTimeout(() => controller.abort(), ...)), the
// returned promise would simply hang forever and the test would time out
// instead of passing — unlike a plain `signal instanceof AbortSignal` check,
// which is satisfied by a signal that is never aborted.
const hangUntilAborted = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")));
});

// The per-test timeout matters here: without the abort in request(), the stubbed
// fetch never settles. node --test has no default timeout, so the run would hang
// forever instead of reporting a clear failure.
test("aborts and returns null when a request never responds within timeoutMs", { timeout: 2000 }, async () => {
    const start = Date.now();
    const result = await fetchImageVersionLabel("registry.example.com", "img", "latest", {
        fetchImpl: hangUntilAborted,
        timeoutMs: 20
    });
    const elapsed = Date.now() - start;

    assert.equal(result, null);
    // Well under the 10s default (REQUEST_TIMEOUT_MS) — proves the call
    // actually terminated because the 20ms timeout aborted it, not because
    // it happened to resolve some other way.
    assert.ok(elapsed < 2000, `expected the request to abort quickly, took ${elapsed}ms`);
});

test("the anonymous token request carries no Authorization header and is genuinely time-bounded", { timeout: 2000 }, async () => {
    const calls = [];
    let manifestCalls = 0;
    const fetchImpl = (url, options) => {
        calls.push({ url, options });
        if (url.includes("/v2/token")) return hangUntilAborted(url, options);
        if (url.includes("/manifests/latest")) {
            manifestCalls += 1;
            if (manifestCalls === 1) {
                return Promise.resolve(jsonResponse({}, {
                    status: 401,
                    headers: { "www-authenticate": 'Bearer realm="https://registry.example.com/v2/token",service="reg"' }
                }));
            }
            return Promise.resolve(jsonResponse(INDEX));
        }
        return Promise.reject(new Error(`unexpected request: ${url}`));
    };

    const start = Date.now();
    const result = await fetchImageVersionLabel("registry.example.com", "img", "latest", { fetchImpl, timeoutMs: 20 });
    const elapsed = Date.now() - start;

    assert.equal(result, null);
    assert.ok(elapsed < 2000, `expected the token request to abort quickly, took ${elapsed}ms`);

    const tokenCall = calls.find(c => c.url.includes("/v2/token"));
    assert.ok(tokenCall, "expected a token request to have been made");
    assert.equal(tokenCall.options?.headers?.Authorization, undefined);
    assert.ok(tokenCall.options?.signal instanceof AbortSignal, "token request must carry an AbortSignal");
});

test("a token response body exceeding MAX_BODY_BYTES yields null instead of being parsed", async () => {
    const calls = [];
    let manifestCalls = 0;
    const oversizedToken = "x".repeat(1_000_001);
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (url.includes("/v2/token")) return jsonResponse({ token: oversizedToken });
        if (url.includes("/manifests/latest")) {
            manifestCalls += 1;
            if (manifestCalls === 1) {
                return jsonResponse({}, {
                    status: 401,
                    headers: { "www-authenticate": 'Bearer realm="https://registry.example.com/v2/token",service="reg"' }
                });
            }
            return jsonResponse(INDEX);
        }
        throw new Error(`unexpected request: ${url}`);
    };

    assert.equal(await fetchImageVersionLabel("registry.example.com", "img", "latest", { fetchImpl }), null);
    assert.ok(calls.some(c => c.url.includes("/v2/token")));
});
