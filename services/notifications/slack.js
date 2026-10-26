/**
 * Slack notifier via Web API (chat.postMessage).
 * Configured via SLACK_BOT_TOKEN and SLACK_CHANNEL_ID env variables.
 * No-op if either variable is not set.
 */
export async function send(ticket) {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;
    if (!token || !channel) return;

    const payload = {
        channel,
        text: `Neues Ticket erstellt`,
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🚨 *Neues Ticket #${ticket.ticket_id}*\n*${ticket.ticket_subject}*`
                }
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Status:* ${ticket.state || 'open'}` },
                    { type: 'mrkdwn', text: `*Erstellt:* ${new Date(ticket.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` }
                ]
            }
        ]
    };

    const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`Slack API request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
    }
}
