/**
 * Minimal semver helpers for the update check.
 *
 * Deliberately dependency-free: only "MAJOR.MINOR.PATCH" is understood and
 * anything else (pre-releases, tag names like "latest") is treated as unusable.
 */

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStableVersion(value) {
    return typeof value === 'string' && STABLE.test(value.trim());
}

// Compares two version strings. Returns 1 if a > b, -1 if a < b, 0 if a == b or either is unparseable.
// Note: 0 means "equal or unusable", so filter with isStableVersion() first if needed.
export function compareSemver(a, b) {
    const pa = String(a).trim().match(STABLE);
    const pb = String(b).trim().match(STABLE);
    if (!pa || !pb) return 0;
    for (let i = 1; i <= 3; i += 1) {
        const diff = Number(pa[i]) - Number(pb[i]);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

export function maxStableVersion(versions) {
    const list = versions ?? [];
    return list
        .filter(isStableVersion)
        .reduce((best, current) => (best === null || compareSemver(current, best) > 0 ? current : best), null);
}
