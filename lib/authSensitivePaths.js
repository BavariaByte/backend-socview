/**
 * Path matcher for Better-Auth credential endpoints that must be
 * brute-force rate limited (wired up in server.js).
 *
 * The trailing `(\/|$)` group is load-bearing: it requires the verb to be
 * followed by a slash or the end of the path, so `/api/auth/sign-in` and
 * `/api/auth/sign-in/email` match while `/api/auth/sign-in-foo` does not.
 * Session polling (`/api/auth/get-session`) intentionally stays unmatched.
 *
 * Kept in its own dependency-free module so tests can assert the matching
 * behavior without importing server.js (which connects to MongoDB on load).
 */
export const AUTH_SENSITIVE_PATHS =
  /^\/api\/auth\/(sign-in|sign-up|forget-password|reset-password|change-password|change-email|delete-user)(\/|$)/;
