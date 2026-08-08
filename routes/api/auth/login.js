/**
 * POST /api/auth/login
 * Note: login is handled externally (e.g. via Azure or Auth0).
 */
export default async function login(req, res) {
  res.status(501).json({ error: "Login is handled by external identity provider" });
}
