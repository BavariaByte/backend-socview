import { logger } from "../../../lib/logger.js";
import crypto from 'crypto';
import { UserPreferences } from '@girp/database-models';
import { sendVerificationEmail } from '../../../services/notifications/email.js';

/**
 * POST /api/auth/preferences/resend-verification
 *
 * Resends the verification email for the current user's customEmail.
 */
export default async function resendVerification(req, res) {
    try {
        const userId = req.sessionUser?.userid || req.sessionUser?._id || req.user?.id || req.user?.userid || req.user?.oid;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const prefs = await UserPreferences.findOne({ userId });

        if (!prefs?.notifications?.email?.customEmail) {
            return res.status(400).json({ error: "No custom email configured" });
        }

        if (prefs.notifications.email.customEmailVerified) {
            return res.status(400).json({ error: "Email already verified" });
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await UserPreferences.updateOne(
            { userId },
            {
                $set: {
                    'notifications.email.customEmailToken': hashedToken,
                    'notifications.email.customEmailTokenExpiry': expiry
                }
            }
        );

        await sendVerificationEmail(prefs.notifications.email.customEmail, rawToken);

        res.json({ message: "Verification email sent" });
    } catch (error) {
        logger.error({ err: error }, '[POST /api/auth/preferences/resend-verification]');
        res.status(500).json({ error: "Failed to resend verification email" });
    }
}
