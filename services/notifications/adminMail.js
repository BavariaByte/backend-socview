import { detectTransport, createTransporter, getFromAddress } from './transport.js';
import { resolveAdminRecipients } from './adminRecipients.js';
import { logger } from '../../lib/logger.js';

/**
 * Sends a platform/admin mail to the super admin and every opted-in admin.
 *
 * Callers pass a fully rendered German and English variant; each recipient
 * gets the one matching their language preference (German is the default).
 * Never throws — all call sites are fire-and-forget.
 *
 * @param {{de: {subject: string, text: string, html: string},
 *          en: {subject: string, text: string, html: string}}} content
 */
export async function sendAdminMail(content, { resolve = resolveAdminRecipients } = {}) {
    try {
        if (!detectTransport()) {
            logger.debug('[adminMail] No SMTP transport configured — skipping');
            return;
        }

        const recipients = await resolve();
        if (recipients.length === 0) {
            logger.debug('[adminMail] No admin recipients — skipping');
            return;
        }

        const transporter = createTransporter();
        const from = getFromAddress();

        const results = await Promise.allSettled(recipients.map(({ email, language }) => {
            const variant = content[normalizeLang(language)] || content.de;
            return transporter.sendMail({ from, to: email, ...variant });
        }));

        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            logger.error({ err: failed[0].reason, failed: failed.length, total: recipients.length },
                '[adminMail] Some admin mails could not be delivered');
        }
    } catch (err) {
        logger.error({ err }, '[adminMail] Failed to send admin mail');
    }
}

/** Maps preference values like "de", "de-DE", "en-US" onto the two mail variants. */
export function normalizeLang(value) {
    return String(value || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}
