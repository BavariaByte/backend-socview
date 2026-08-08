import { logger } from "../../../lib/logger.js";
import crypto from 'crypto';
import { UserPreferences as UserPreferencesModel } from "@girp/database-models";
import { sendVerificationEmail } from "../../../services/notifications/email.js";

/**
 * PUT /api/auth/preferences
 * Updates the preferences for the currently authenticated user.
 * If notifications.email.customEmail changes, resets verification and sends a new verification email.
 */
export default async function updateUserPreferences(req, res) {
    try {
        const userId = req.sessionUser?.userid || req.sessionUser?._id || req.user?.id || req.user?.userid || req.user?.oid;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const { timezone, language, theme, notifications, dataRetention, updateNotice } = req.body;

        const update = {};
        if (timezone !== undefined) update.timezone = timezone;
        if (language !== undefined) update.language = language;
        if (theme !== undefined) update.theme = theme;
        if (dataRetention !== undefined) update.dataRetention = dataRetention;

        // Only the dismissed version is writable here; anything else is ignored.
        if (updateNotice !== undefined) {
            const dismissed = updateNotice?.dismissedVersion;
            if (dismissed === null) {
                update['updateNotice.dismissedVersion'] = null;
            } else if (typeof dismissed === 'string' && dismissed.length <= 32 && /^[0-9A-Za-z.-]+$/.test(dismissed)) {
                update['updateNotice.dismissedVersion'] = dismissed;
            }
        }

        let verificationTriggered = false;

        if (notifications?.email !== undefined) {
            const emailPrefs = notifications.email;

            const existing = await UserPreferencesModel.findOne({ userId });
            // Guard against legacy documents where notifications was stored as a plain string
            const existingEmail = (existing?.notifications && typeof existing.notifications === 'object')
                ? (existing.notifications.email || {})
                : {};

            const existingCustomEmail = existingEmail.customEmail ?? null;
            const newCustomEmail = emailPrefs.customEmail || null;
            const customEmailChanged = newCustomEmail !== existingCustomEmail;

            // Build the full email prefs object — replaces the field entirely so that
            // legacy string values ("email") in MongoDB are overwritten cleanly.
            const newEmailPrefs = {
                enabled: emailPrefs.enabled ?? false,
                useLoginEmail: emailPrefs.useLoginEmail ?? true,
                customEmail: newCustomEmail,
                customEmailVerified: existingEmail.customEmailVerified ?? false,
                customEmailToken: existingEmail.customEmailToken ?? null,
                customEmailTokenExpiry: existingEmail.customEmailTokenExpiry ?? null,
            };

            if (customEmailChanged && newCustomEmail) {
                const rawToken = crypto.randomBytes(32).toString('hex');
                const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
                const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

                newEmailPrefs.customEmailVerified = false;
                newEmailPrefs.customEmailToken = hashedToken;
                newEmailPrefs.customEmailTokenExpiry = expiry;

                verificationTriggered = { rawToken, newCustomEmail };
            } else if (!newCustomEmail) {
                newEmailPrefs.customEmailVerified = false;
                newEmailPrefs.customEmailToken = null;
                newEmailPrefs.customEmailTokenExpiry = null;
            }

            update['notifications'] = { email: newEmailPrefs };
        }

        const prefs = await UserPreferencesModel.findOneAndUpdate(
            { userId },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        if (verificationTriggered) {
            try {
                await sendVerificationEmail(verificationTriggered.newCustomEmail, verificationTriggered.rawToken);
            } catch (mailErr) {
                logger.error({ err: mailErr }, '[updateUserPreferences] Failed to send verification email');
            }
        }

        res.json(prefs);
    } catch (error) {
        logger.error({ err: error }, "[PUT /api/auth/preferences]");
        res.status(500).json({ error: "Unable to update preferences" });
    }
}
