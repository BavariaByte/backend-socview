/**
 * Microsoft Teams notifier via Power Automate Workflow Webhook (Adaptive Cards).
 *
 * This is Microsoft's current, supported approach for sending messages to Teams
 * channels from external services without a signed-in user.
 *
 * Background: The Microsoft Graph API permission "ChannelMessage.Send" exists
 * only as a Delegated permission (requires a signed-in user). There is no
 * Application permission that allows a service principal to post channel
 * messages directly via Graph API. Power Automate Workflows are Microsoft's
 * recommended replacement for the deprecated Office 365 Connectors.
 *
 * Setup:
 *   1. In Teams, open the target channel.
 *   2. Click "..." → "Workflows" (or "+ Add workflow" from the channel header).
 *   3. Search for "Post to a channel when a webhook request is received" and select it.
 *   4. Follow the wizard — it creates a Power Automate flow and returns a webhook URL.
 *   5. Copy the webhook URL into NOTIFY_TEAMS_WORKFLOW_URL.
 *
 * The Adaptive Card format used here is not deprecated and is actively maintained.
 *
 * Required env var:
 *   NOTIFY_TEAMS_WORKFLOW_URL — webhook URL from the Power Automate workflow
 */
import { logger } from "../../lib/logger.js";

export async function send(ticket) {
    const webhookUrl = process.env.NOTIFY_TEAMS_WORKFLOW_URL;
    if (!webhookUrl) return;

    // Adaptive Card payload (schema 1.4, supported by Teams)
    const payload = {
        type: 'message',
        attachments: [
            {
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    type: 'AdaptiveCard',
                    version: '1.4',
                    body: [
                        {
                            type: 'TextBlock',
                            text: `🚨 Neues Ticket #${ticket.ticket_id}`,
                            weight: 'Bolder',
                            size: 'Medium'
                        },
                        {
                            type: 'TextBlock',
                            text: ticket.ticket_subject,
                            wrap: true
                        },
                        {
                            type: 'FactSet',
                            facts: [
                                { title: 'Status', value: ticket.state || 'open' },
                                { title: 'Erstellt', value: new Date(ticket.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) }
                            ]
                        }
                    ]
                }
            }
        ]
    };

    const body = JSON.stringify(payload);
    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });

    const responseText = await res.text();
    if (!res.ok) {
        throw new Error(`Teams webhook failed: HTTP ${res.status} — ${responseText}`);
    }
    if (responseText && responseText !== '1' && responseText.toLowerCase().includes('error')) {
        logger.warn(`[Teams] Webhook returned HTTP ${res.status} but response indicates an error: ${responseText}`);
    }
}
