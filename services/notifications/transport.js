import nodemailer from 'nodemailer';

/**
 * Shared SMTP transport helpers.
 *
 * Extracted from notifications/email.js so the ticket notifier and the
 * platform/admin mails use exactly the same transport configuration.
 */

export function detectTransport() {
    if (process.env.SMTP_HOST) return 'smtp';
    return null;
}

export function createTransporter() {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        authMethod: process.env.SMTP_AUTH_METHOD || undefined,
        auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        } : undefined
    });
}

export function getFromAddress() {
    return process.env.SMTP_FROM || 'noreply@example.com';
}
