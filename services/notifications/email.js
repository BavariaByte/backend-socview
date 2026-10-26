import { UserPreferences, UserModel } from '@girp/database-models';
import { escapeHtml } from '../../routes/api/middleware/sanitize.js';
import { detectTransport, createTransporter, getFromAddress } from './transport.js';

async function sendViaSmtp(recipients, { subject, text, html }) {
    const transporter = createTransporter();
    const from = getFromAddress();
    await transporter.sendMail({ from, to: recipients.join(', '), subject, text, html });
}

async function sendViaSmtpPersonalized(transporter, email, content) {
    const from = getFromAddress();
    await transporter.sendMail({ from, to: email, ...content });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DEFAULT_TZ = 'Europe/Berlin';

function buildEmailContent(ticket, timezone = DEFAULT_TZ) {
    // Escape every interpolated field — ticket_subject and state are the
    // user-controlled vectors that previously allowed HTML injection.
    const safeId = escapeHtml(ticket.ticket_id);
    const safeSubject = escapeHtml(ticket.ticket_subject);
    const safeState = escapeHtml(ticket.state || 'open');
    const createdAt = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('de-DE', { timeZone: timezone }) : '';
    const safeCreatedAt = escapeHtml(createdAt);

    return {
        subject: `[GIRP] Neues Ticket #${ticket.ticket_id}: ${ticket.ticket_subject}`,
        text: [
            `Ein neues Ticket wurde im GIRP SoC erstellt.`,
            ``,
            `Ticket-ID:  #${ticket.ticket_id}`,
            `Betreff:    ${ticket.ticket_subject}`,
            `Status:     ${ticket.state || 'open'}`,
            `Erstellt:   ${createdAt}`,
        ].join('\n'),
        html: `
            <h2>🚨 Neues Ticket #${safeId}</h2>
            <p><strong>${safeSubject}</strong></p>
            <table>
                <tr><td><strong>Status:</strong></td><td>${safeState}</td></tr>
                <tr><td><strong>Erstellt:</strong></td><td>${safeCreatedAt}</td></tr>
            </table>
        `
    };
}

async function resolveRecipients() {
    const recipients = new Map(); // email → timezone

    if (process.env.NOTIFY_EMAIL) recipients.set(process.env.NOTIFY_EMAIL, DEFAULT_TZ);

    const allPrefs = await UserPreferences.find({ 'notifications.email.enabled': true });

    for (const prefs of allPrefs) {
        const tz = prefs.timezone || DEFAULT_TZ;
        let email = null;

        if (prefs.notifications?.email?.useLoginEmail) {
            const user = await UserModel.findOne({ userid: prefs.userId }).select('e_mail');
            email = user?.e_mail || null;
        } else if (prefs.notifications?.email?.customEmail && prefs.notifications?.email?.customEmailVerified) {
            email = prefs.notifications.email.customEmail;
        }

        if (email) recipients.set(email, tz);
    }

    return Array.from(recipients.entries()).map(([email, timezone]) => ({ email, timezone }));
}

async function dispatch(recipients, content) {
    if (detectTransport() === 'smtp') return sendViaSmtp(recipients, content);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends to an explicit recipient list, skipping the database lookup.
 * Used by the test script and anywhere a fixed recipient is known upfront.
 */
export async function sendDirect(recipients, ticket) {
    if (!detectTransport() || recipients.length === 0) return;
    await dispatch(recipients, buildEmailContent(ticket));
}

/**
 * Email notifier entry point — called for every new ticket.
 * No-op if SMTP is not configured.
 */
export async function send(ticket) {
    if (!detectTransport()) return;
    const recipients = await resolveRecipients();
    if (recipients.length === 0) return;
    const transporter = createTransporter();
    await Promise.all(
        recipients.map(({ email, timezone }) =>
            sendViaSmtpPersonalized(transporter, email, buildEmailContent(ticket, timezone))
        )
    );
}

/**
 * Sends a verification email to a custom email address.
 * Called from updateUserPreferences when customEmail changes.
 */
export async function sendVerificationEmail(toEmail, rawToken) {
    if (!detectTransport()) throw new Error('No email transport configured — cannot send verification email');

    const backendUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
    const verifyLink = `${backendUrl}/api/auth/preferences/verify-email?token=${encodeURIComponent(rawToken)}`;

    await dispatch([toEmail], {
        subject: '[GIRP] E-Mail-Adresse bestätigen',
        text: `Bitte bestätige deine E-Mail-Adresse für GIRP-Benachrichtigungen:\n\n${verifyLink}\n\nDer Link ist 24 Stunden gültig.`,
        html: `
            <h2>E-Mail-Adresse bestätigen</h2>
            <p>Klicke auf den folgenden Link, um deine E-Mail-Adresse zu bestätigen:</p>
            <p><a href="${verifyLink}">${verifyLink}</a></p>
            <p>Der Link ist 24 Stunden gültig.</p>
        `
    });
}
