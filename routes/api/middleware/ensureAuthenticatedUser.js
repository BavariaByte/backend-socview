import { logger } from "../../../lib/logger.js";
import { UserModel, Settings } from "@girp/database-models";
import { escapeRegex } from "./sanitize.js";
import { IS_DEV } from "../../../lib/env.js";
import { notifyPendingUser } from "../../../services/notifications/pendingUserMail.js";

/**
 * Ensure unique indexes once per process, not per request.
 * Idempotent on the MongoDB side, but skipping the per-request roundtrip
 * removes a measurable hot-path cost.
 */
let indexesEnsured = false;
async function ensureIndexesOnce() {
  if (indexesEnsured) return;
  indexesEnsured = true;
  try {
    await UserModel.collection.createIndex({ userid: 1 }, { unique: true, background: true });
    await UserModel.collection.createIndex({ e_mail: 1 }, { unique: true, background: true });
  } catch (e) {
    // Surface the failure but do not block requests — indexes may already
    // exist or be in the process of being created by a concurrent worker.
    logger.warn({ err: e }, "[ensureAuthenticatedUser] User index creation skipped");
    // Allow retry on next request in case of transient errors.
    indexesEnsured = false;
  }
}

/**
 * Ensures the SUPER_ADMIN_EMAIL user always has both 'admin' and 'super_admin' roles.
 * Removes 'super_admin' from all other users (downgrades to 'admin' or keeps existing roles).
 * Only runs when the super_admin user themselves logs in.
 */
async function syncSuperAdmin(email, record) {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  if (!superAdminEmail || email?.toLowerCase() !== superAdminEmail) return;

  const currentRoles = Array.isArray(record.roles) ? record.roles : [];
  const hasSuperAdmin = currentRoles.includes('super_admin');
  const hasAdmin = currentRoles.includes('admin');

  if (!hasSuperAdmin || !hasAdmin) {
    const newRoles = [...new Set([...currentRoles.filter(r => r !== 'pending' && r !== 'deactivated'), 'admin', 'super_admin'])];
    record.roles = newRoles;
    await record.save();
    // Only clean up other users when we actually assign the role
    await UserModel.updateMany(
      { _id: { $ne: record._id }, roles: 'super_admin' },
      { $pull: { roles: 'super_admin' } }
    );
    logger.info(`[syncSuperAdmin] Assigned super_admin to user ${record._id}`);
    logger.debug(`[syncSuperAdmin] Super admin email: ${email}`);
  }
}

/**
 * Middleware: ensureAuthenticatedUser
 *
 * Ensures that every authenticated API request has a corresponding user
 * in the database. Missing entries are created automatically from the
 * token claims provided by the authentication middlewares.
 *
 * Sets `req.sessionUser` to the found or newly created user.
 */
export default async function ensureAuthenticatedUser(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const email = req.user.email
      || req.user.payload?.preferred_username
      || req.user.payload?.upn
      || req.user.payload?.email;

    const userId = req.user.oid
      || req.user.payload?.oid
      || req.user.sub
      || email;

    const username = req.user.payload?.name
      || req.user.payload?.nickname
      || email
      || userId;

    const image = req.user.image
      || req.user.payload?.picture
      || req.user.payload?.avatar_url;

    const provider = req.user.payload?.iss
      || req.user.iss
      || "auto";

    if (!email || !userId) {
      return res.status(400).json({ error: "Unable to derive user identity from token" });
    }

    // Ensure unique indexes exist — first request after process start triggers
    // the createIndex calls; subsequent requests short-circuit on the boolean.
    await ensureIndexesOnce();

    // 1. Try to find by UserID (exact match)
    let record = await UserModel.findOne({ userid: userId });

    // 2. If not found, try by Email (case-insensitive, regex-safe)
    if (!record && email) {
      record = await UserModel.findOne({
        e_mail: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") }
      });
    }

    if (record) {
      // Update existing record
      let needsSave = false;
      if (record.userid !== userId) { record.userid = userId; needsSave = true; }
      if (record.sso_provider !== provider) { record.sso_provider = provider; needsSave = true; }
      if (record.username !== username) { record.username = username; needsSave = true; }
      if (image && record.image !== image) { record.image = image; needsSave = true; }

      // Backfill roles if empty
      if (!record.roles || record.roles.length === 0) {
        const isLoginEndpoint =
          req.originalUrl?.includes('/api/auth/me') ||
          req.originalUrl?.includes('/api/auth/get-session');

        if (isLoginEndpoint) {
          let backfillRoles = ["pending"];
          const isDev = IS_DEV;

          if (isDev) {
            backfillRoles = ["admin"];
          } else if (req.user && Array.isArray(req.user.groups)) {
            try {
              const [adminGroupSetting, managerGroupSetting] = await Promise.all([
                Settings.findOne({ key: "entra_admin_group" }),
                Settings.findOne({ key: "entra_playbook_manager_group" })
              ]);
              const adminGroup = adminGroupSetting?.value;
              const managerGroup = managerGroupSetting?.value;

              if (adminGroup && req.user.groups.includes(adminGroup)) {
                backfillRoles = ["admin"];
              } else if (managerGroup && req.user.groups.includes(managerGroup)) {
                backfillRoles = ["playbook_manager"];
              }
            } catch (err) {
              logger.error({ err }, "[ensureAuthenticatedUser] Error evaluating Entra groups for backfill");
            }
          }

          logger.info(`[ensureAuthenticatedUser] Backfilling empty roles for user ${record._id} with [${backfillRoles}]`);

          // Atomically claim the backfill so that of several concurrent requests
          // for the same record, only the one that actually flips roles from
          // empty to non-empty wins — and only that one sends the mail.
          const claimed = await UserModel.updateOne(
            // `roles: null` is matched too, so the filter accepts every shape the
            // JS guard above treats as "needs backfill" — otherwise such a record
            // could never be claimed and would keep its empty roles forever.
            { _id: record._id, $or: [{ roles: { $exists: false } }, { roles: null }, { roles: { $size: 0 } }] },
            { $set: { roles: backfillRoles } }
          );

          if (claimed.modifiedCount === 1) {
            // We won the race: keep the in-memory record in sync with what was persisted.
            record.roles = backfillRoles;

            if (backfillRoles.length === 1 && backfillRoles[0] === "pending") {
              // Fire-and-forget: the login must not wait for SMTP.
              notifyPendingUser({ username, email, provider });
            }
          } else {
            // Another concurrent request already claimed the backfill; re-read so the
            // rest of this request (and the pending/deactivated gate below) sees the
            // roles that were actually persisted. No mail is sent from this request.
            const fresh = await UserModel.findById(record._id).select("roles");
            record.roles = fresh?.roles || record.roles;
          }

          needsSave = true;
        }
      }

      if (needsSave) await record.save();
    } else {
      // Check if this is a login request
      const isLoginEndpoint =
        req.originalUrl?.includes('/api/auth/me') ||
        req.originalUrl?.includes('/api/auth/get-session');

      if (!isLoginEndpoint) {
        return res.status(401).json({ error: "User account not found or has been deleted. Please log in again." });
      }

      // Create new record atomically using findOneAndUpdate with upsert
      let initialRoles = ["pending"];
      // True only when this request performed the insert (not merely read back a
      // document a concurrent request already inserted), so the notification below
      // can never fire from a request that lost the creation race.
      let createdByThisRequest = false;
      try {
        const isDev = (process.env.NODE_ENV || "").toLowerCase().startsWith("dev");

        if (isDev) {
          initialRoles = ["admin"];
        } else if (req.user && Array.isArray(req.user.groups) && req.user.groups.length > 0) {
          try {
            const [adminGroupSetting, managerGroupSetting] = await Promise.all([
              Settings.findOne({ key: "entra_admin_group" }),
              Settings.findOne({ key: "entra_playbook_manager_group" })
            ]);
            const adminGroup = adminGroupSetting?.value;
            const managerGroup = managerGroupSetting?.value;

            if (adminGroup && req.user.groups.includes(adminGroup)) {
              initialRoles = ["admin"];
            } else if (managerGroup && req.user.groups.includes(managerGroup)) {
              initialRoles = ["playbook_manager"];
            }
          } catch (err) {
            logger.error({ err }, "[ensureAuthenticatedUser] Error evaluating Entra groups");
          }
        }

        logger.info(`[ensureAuthenticatedUser] Creating new user with roles: [${initialRoles}]`);

        const upsertResult = await UserModel.findOneAndUpdate(
          { userid: userId },
          {
            $setOnInsert: {
              e_mail: email,
            },
            $set: {
              sso_provider: provider,
              username: username,
              image: image,
              roles: initialRoles && initialRoles.length > 0 ? initialRoles : ["pending"]
            }
          },
          { new: true, upsert: true, includeResultMetadata: true }
        );
        record = upsertResult.value;
        // lastErrorObject.updatedExisting === false is MongoDB's definitive signal
        // that this call performed the insert, rather than updating a document that
        // already existed (e.g. inserted by a concurrent request just before this one).
        createdByThisRequest = upsertResult.lastErrorObject?.updatedExisting === false;
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate-key race: a concurrent request won the insert. Re-read its
          // record; this request did not create it, so createdByThisRequest stays
          // false and the notification below is skipped for this request.
          record = await UserModel.findOne({
            $or: [
              { userid: userId },
              { e_mail: { $regex: new RegExp(`^${escapeRegex(email)}$`, "i") } }
            ]
          });
        }
        if (!record) throw err;
      }

      // Notify only when this request actually created the record, and gate on the
      // persisted roles (not the request-local initialRoles): a losing request must
      // never send a mail for a user it didn't create, nor one that disagrees with
      // what was actually saved (e.g. divergent Entra-group evaluation between racers).
      if (
        createdByThisRequest &&
        Array.isArray(record?.roles) &&
        record.roles.length === 1 &&
        record.roles[0] === "pending"
      ) {
        // Fire-and-forget: the login must not wait for SMTP.
        notifyPendingUser({ username, email, provider });
      }
    }

    // Always sync super_admin before the pending/deactivated block so the
    // SUPER_ADMIN_EMAIL user is never locked out regardless of their current roles.
    // No-op for all other users (early return on email mismatch).
    await syncSuperAdmin(email, record);

    req.sessionUser = record;

    // Block pending and deactivated users from all endpoints except session-read routes
    const exemptPaths = ['/api/auth/me', '/api/auth/get-session'];
    const isExempt = exemptPaths.some(p => req.originalUrl?.includes(p));

    if (!isExempt) {
      const userRoles = record?.roles || [];
      if (userRoles.includes('pending')) {
        return res.status(403).json({ error: 'ACCESS_PENDING' });
      }
      if (userRoles.includes('deactivated')) {
        return res.status(403).json({ error: 'ACCESS_DEACTIVATED' });
      }
    }

    next();
  } catch (error) {
    logger.error({ err: error }, "[ensureAuthenticatedUser]");
    res.status(500).json({ error: "Failed to reconcile authenticated user" });
  }
}
