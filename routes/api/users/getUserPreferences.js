import { logger } from "../../../lib/logger.js";
import { UserPreferences as UserPreferencesModel } from "@girp/database-models";

/**
 * GET /api/auth/preferences
 * Returns the preferences for the currently authenticated user.
 */
export default async function getUserPreferences(req, res) {
    try {
        const userId = req.sessionUser?.userid || req.sessionUser?._id || req.user?.id || req.user?.userid || req.user?.oid;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        let prefs = await UserPreferencesModel.findOne({ userId });

        if (!prefs) {
            return res.json({
                timezone: "Europe/Berlin",
                language: "de-DE",
                theme: "light",
                notifications: {
                    email: {
                        enabled: false,
                        useLoginEmail: true,
                        customEmail: null,
                        customEmailVerified: false
                    }
                },
                dataRetention: "30",
                updateNotice: { dismissedVersion: null }
            });
        }

        // Normalize legacy String notifications field to new object shape
        let notificationsData = prefs.notifications;
        if (!notificationsData || typeof notificationsData !== 'object' || !notificationsData.email) {
            notificationsData = {
                email: {
                    enabled: false,
                    useLoginEmail: true,
                    customEmail: null,
                    customEmailVerified: false
                }
            };
        }

        res.json({
            timezone: prefs.timezone,
            language: prefs.language,
            theme: prefs.theme,
            notifications: notificationsData,
            dataRetention: prefs.dataRetention,
            // Must be returned: the client resets its dismissed version from
            // this response, so omitting it makes "remind me later" forget the
            // dismissal on the next preferences fetch.
            updateNotice: { dismissedVersion: prefs.updateNotice?.dismissedVersion ?? null }
        });
    } catch (error) {
        logger.error({ err: error }, "[GET /api/auth/preferences]");
        res.status(500).json({ error: "Unable to retrieve preferences" });
    }
}
