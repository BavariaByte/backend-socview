import { logger } from "../../../lib/logger.js";
import crypto from 'crypto';
import { UserPreferences } from '@girp/database-models';

/**
 * GET /api/auth/preferences/verify-email?token=<rawToken>
 *
 * Verifies a custom email address by matching the token hash.
 * Redirects to frontend settings page with verify= query param.
 */
export default async function verifyEmail(req, res) {
    const frontendUrl = process.env.PLATFORM_URL || 'http://localhost:5173';
    const redirectBase = `${frontendUrl}/settings`;

    try {
        const rawToken = req.query.token;
        if (!rawToken) {
            return res.redirect(`${redirectBase}?verify=invalid`);
        }

        const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

        const prefs = await UserPreferences.findOne({
            'notifications.email.customEmailToken': hashedToken
        });

        if (!prefs) {
            return res.redirect(`${redirectBase}?verify=invalid`);
        }

        if (prefs.notifications.email.customEmailTokenExpiry < new Date()) {
            return res.redirect(`${redirectBase}?verify=expired`);
        }

        await UserPreferences.updateOne(
            { _id: prefs._id },
            {
                $set: {
                    'notifications.email.customEmailVerified': true,
                    'notifications.email.customEmailToken': null,
                    'notifications.email.customEmailTokenExpiry': null
                }
            }
        );

        return res.redirect(`${redirectBase}?verify=success`);
    } catch (error) {
        logger.error({ err: error }, '[GET /api/auth/preferences/verify-email]');
        return res.redirect(`${redirectBase}?verify=error`);
    }
}
