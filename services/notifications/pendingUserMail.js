import { sendAdminMail } from './adminMail.js';
import { escapeHtml } from '../../routes/api/middleware/sanitize.js';
import { logger } from '../../lib/logger.js';

/**
 * Notifies admins that a new user signed in and is waiting for approval.
 * Fire-and-forget: callers must not await this and it never throws.
 */
export function notifyPendingUser({ username, email, provider }) {
    const safeName = escapeHtml(username || 'unknown');
    const safeEmail = escapeHtml(email || 'unknown');
    const safeProvider = escapeHtml(provider || 'unknown');
    const userAdminUrl = `${(process.env.PLATFORM_URL || '').replace(/\/$/, '')}/admin/users`;

    const content = {
        de: {
            subject: '[GIRP] Neuer Benutzer wartet auf Freischaltung',
            text: [
                'Ein neuer Benutzer hat sich angemeldet und wartet auf Freischaltung.',
                '',
                `Name:     ${username || 'unbekannt'}`,
                `E-Mail:   ${email || 'unbekannt'}`,
                `Anmeldung über: ${provider || 'unbekannt'}`,
                '',
                `Benutzerverwaltung: ${userAdminUrl}`
            ].join('\n'),
            html: `
                <h2>Neuer Benutzer wartet auf Freischaltung</h2>
                <table>
                    <tr><td><strong>Name:</strong></td><td>${safeName}</td></tr>
                    <tr><td><strong>E-Mail:</strong></td><td>${safeEmail}</td></tr>
                    <tr><td><strong>Anmeldung über:</strong></td><td>${safeProvider}</td></tr>
                </table>
                <p><a href="${userAdminUrl}">Benutzerverwaltung öffnen</a></p>
            `
        },
        en: {
            subject: '[GIRP] New user awaiting approval',
            text: [
                'A new user signed in and is waiting for approval.',
                '',
                `Name:     ${username || 'unknown'}`,
                `Email:    ${email || 'unknown'}`,
                `Signed in via: ${provider || 'unknown'}`,
                '',
                `User management: ${userAdminUrl}`
            ].join('\n'),
            html: `
                <h2>New user awaiting approval</h2>
                <table>
                    <tr><td><strong>Name:</strong></td><td>${safeName}</td></tr>
                    <tr><td><strong>Email:</strong></td><td>${safeEmail}</td></tr>
                    <tr><td><strong>Signed in via:</strong></td><td>${safeProvider}</td></tr>
                </table>
                <p><a href="${userAdminUrl}">Open user management</a></p>
            `
        }
    };

    sendAdminMail(content).catch(err =>
        logger.error({ err }, '[pendingUserMail] Failed to notify admins'));
}
