import { logger } from "../../../lib/logger.js";
import { UserModel } from "@girp/database-models";
import { mapUser } from "../users/utils.js";
import { checkIsAdmin } from "../middleware/requireAdmin.js";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user from the SOC database, including roles.
 */
export default async function getSession(req, res) {
  try {
    let sessionUser = null;

    if (req.sessionUser?._id) {
      sessionUser = await UserModel.findById(req.sessionUser._id);
    }

    if (!sessionUser) {
      const emailCandidates = [
        req.user?.email,
        req.user?.payload?.preferred_username,
        req.user?.payload?.upn,
      ].filter(Boolean);

      for (const email of emailCandidates) {
        sessionUser = await UserModel.findOne({ e_mail: email });
        if (sessionUser) break;
      }
    }

    const formatted = sessionUser ? mapUser(sessionUser) : null;

    // Dynamically add the admin role when entitled
    const roles = Array.isArray(sessionUser?.roles) ? [...sessionUser.roles] : [];
    const isAdmin = await checkIsAdmin(req.user, sessionUser);

    if (isAdmin && !roles.includes("admin")) {
      roles.push("admin");
    }

    // Whitelist token claims sent to the client — never expose the raw JWT
    // payload (groups, AzureAD-internal claims, etc.).
    const tokenClaims = req.user
      ? {
          sub: req.user.sub ?? null,
          email: req.user.email ?? null,
          name: req.user.name ?? req.user.payload?.name ?? null,
          provider: req.user.payload?.iss ?? null,
        }
      : null;

    res.json({
      user: formatted,
      roles: roles,
      tokenClaims,
      session: req.betterAuthSession?.session ? true : null,
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/auth/me]");
    res.status(500).json({ error: "Unable to resolve session" });
  }
}
