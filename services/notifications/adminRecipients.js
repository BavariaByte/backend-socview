import { UserModel, UserPreferences, Settings } from '@girp/database-models';
import { logger } from '../../lib/logger.js';

const DEFAULT_TZ = 'Europe/Berlin';
const DEFAULT_LANG = 'de';
const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Recipients for platform/admin mails (update available, user awaiting approval).
 *
 * Rule (product decision): always SUPER_ADMIN_EMAIL, plus every admin who
 * enabled email notifications in their personal settings. Deliberately
 * different from the ticket notifier, which serves every opted-in user.
 *
 * Dependencies are injectable so the unit tests run without a database.
 */
export async function resolveAdminRecipients({
    UserModelImpl = UserModel,
    UserPreferencesImpl = UserPreferences,
    SettingsImpl = Settings,
    superAdminEmail = process.env.SUPER_ADMIN_EMAIL || null
} = {}) {
    const recipients = new Map(); // lowercased email → { email, timezone, language }

    const add = (email, timezone, language) => {
        if (!email) return;
        const key = email.toLowerCase();
        if (recipients.has(key)) return;
        recipients.set(key, { email, timezone: timezone || DEFAULT_TZ, language: language || DEFAULT_LANG });
    };

    try {
        // Admins can also come from the `admin_emails` whitelist without ever
        // carrying the role in their user document. (The Entra-group route to
        // admin cannot be resolved here: group membership lives in the login
        // token, not in the database — those admins must either hold the role
        // or be listed here to receive platform mails.)
        let whitelistedAdmins = new Set();
        try {
            const setting = await SettingsImpl.findOne({ key: 'admin_emails' });
            const list = Array.isArray(setting?.value) ? setting.value : [];
            whitelistedAdmins = new Set(list.map(e => String(e).toLowerCase()));
        } catch (err) {
            logger.warn({ err }, '[adminRecipients] Could not read the admin_emails whitelist');
        }

        const prefs = await UserPreferencesImpl.find({ 'notifications.email.enabled': true });
        if (prefs.length > 0) {
            const users = await UserModelImpl.find({ userid: { $in: prefs.map(p => p.userId) } });
            const usersById = new Map(users.map(u => [u.userid, u]));

            for (const pref of prefs) {
                const user = usersById.get(pref.userId);
                const roles = Array.isArray(user?.roles) ? user.roles.map(r => String(r).toLowerCase()) : [];
                const isWhitelisted = user?.e_mail && whitelistedAdmins.has(String(user.e_mail).toLowerCase());
                if (!isWhitelisted && !roles.some(role => ADMIN_ROLES.includes(role))) continue;

                const emailPrefs = pref.notifications?.email || {};
                let email = null;
                if (emailPrefs.useLoginEmail) {
                    email = user?.e_mail || null;
                } else if (emailPrefs.customEmail && emailPrefs.customEmailVerified) {
                    email = emailPrefs.customEmail;
                }

                add(email, pref.timezone, pref.language);
            }
        }
    } catch (err) {
        // A database hiccup must never swallow the super admin recipient.
        logger.error({ err }, '[adminRecipients] Failed to resolve opted-in admins');
    }

    // Add the super admin last (and unconditionally): if an opted-in admin's
    // address already matches SUPER_ADMIN_EMAIL, their own timezone/language
    // win the case-insensitive dedup instead of being overwritten by the
    // Europe/Berlin/de defaults. Still guarantees the super admin is present
    // even when the lookup above throws or returns no matching entry.
    add(superAdminEmail, DEFAULT_TZ, DEFAULT_LANG);

    return Array.from(recipients.values());
}
