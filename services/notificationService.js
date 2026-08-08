
import { send as sendEmail } from './notifications/email.js';
import { send as sendSlack } from './notifications/slack.js';
import { send as sendTeams } from './notifications/teams.js';
import { send as sendPagerDuty } from './notifications/pagerduty.js';
import { logger } from "../lib/logger.js";

/**
 * Sends notifications for a newly created ticket to all configured channels.
 * Must be called without await (fire-and-forget) — never delays the HTTP response.
 * Individual channel failures are logged but do not affect other channels.
 *
 * @param {object} ticket - The mapped ticket object from createTicket.js
 */
export async function notifyNewTicket(ticket) {
    const results = await Promise.allSettled([
        sendEmail(ticket),
        sendSlack(ticket),
        sendTeams(ticket),
        sendPagerDuty(ticket)
    ]);

    results.forEach((result, i) => {
        const names = ['email', 'slack', 'teams', 'pagerduty'];
        if (result.status === 'rejected') {
            logger.error({ err: result.reason }, `[NotificationService] ${names[i]} notifier failed`);
        }
    });
}
