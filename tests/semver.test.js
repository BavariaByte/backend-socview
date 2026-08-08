import test from "node:test";
import assert from "node:assert/strict";
import { compareSemver, isStableVersion, maxStableVersion } from "../lib/semver.js";

test("compareSemver orders versions numerically, not lexically", () => {
    assert.equal(compareSemver("1.10.0", "1.9.0"), 1);
    assert.equal(compareSemver("1.0.0", "1.0.1"), -1);
    assert.equal(compareSemver("2.0.0", "1.99.99"), 1);
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("isStableVersion rejects pre-releases and junk", () => {
    assert.equal(isStableVersion("1.0.0"), true);
    assert.equal(isStableVersion("1.1.0-dev"), false);
    assert.equal(isStableVersion("latest"), false);
    assert.equal(isStableVersion(null), false);
});

test("maxStableVersion picks the highest stable entry and ignores the rest", () => {
    assert.equal(maxStableVersion(["1.0.0", "1.2.0", "1.1.0-dev", null, "test"]), "1.2.0");
    assert.equal(maxStableVersion([]), null);
    assert.equal(maxStableVersion(["latest", null]), null);
});

test("isStableVersion rejects leading zeros", () => {
    assert.equal(isStableVersion("01.2.3"), false);
    assert.equal(isStableVersion("1.00.0"), false);
    assert.equal(isStableVersion("1.0.01"), false);
    assert.equal(isStableVersion("1.0.0"), true);
    assert.equal(isStableVersion("0.1.0"), true);
    assert.equal(isStableVersion("10.20.30"), true);
});

test("isStableVersion handles whitespace-padded input", () => {
    assert.equal(isStableVersion(" 1.0.0 "), true);
    assert.equal(isStableVersion("\t1.0.0\n"), true);
});

test("isStableVersion rejects extra segments", () => {
    assert.equal(isStableVersion("1.0.0.1"), false);
    assert.equal(isStableVersion("1.0"), false);
});

test("compareSemver returns 0 for unparseable input", () => {
    // 0 means "equal or unusable" — callers should filter with isStableVersion first
    assert.equal(compareSemver(null, "1.0.0"), 0);
    assert.equal(compareSemver("1.0.0", undefined), 0);
    assert.equal(compareSemver("latest", "1.0.0"), 0);
    assert.equal(compareSemver("1.0", "1.0.0"), 0);
    assert.equal(compareSemver("01.0.0", "1.0.0"), 0);
});

test("maxStableVersion ignores leading zeros", () => {
    assert.equal(maxStableVersion(["01.0.0", "1.0.0", "1.0.01"]), "1.0.0");
    assert.equal(maxStableVersion(["01.2.0", "1.1.0"]), "1.1.0");
});

test("maxStableVersion tolerates null/undefined argument", () => {
    assert.equal(maxStableVersion(null), null);
    assert.equal(maxStableVersion(undefined), null);
});
