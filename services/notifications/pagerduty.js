/**
 * PagerDuty Events API v2 notifier.
 * Configured via NOTIFY_PAGERDUTY_ROUTING_KEY env variable.
 */
export async function send(ticket) {
    const routingKey = process.env.NOTIFY_PAGERDUTY_ROUTING_KEY;
    if (!routingKey) return;

    const payload = {
        routing_key: routingKey,
        event_action: 'trigger',
        dedup_key: `girp-ticket-${ticket.ticket_id}`,
        payload: {
            summary: `Neues GIRP Ticket #${ticket.ticket_id}: ${ticket.ticket_subject}`,
            severity: 'warning',
            source: 'GIRP',
            custom_details: {
                ticket_id: ticket.ticket_id,
                state: ticket.state || 'open',
                created_at: ticket.createdAt
            }
        }
    };

    const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`PagerDuty API failed: ${res.status} ${await res.text()}`);
    }
}
