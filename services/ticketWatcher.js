
import mongoose from "mongoose";
import { notifyNewTicket } from "./notificationService.js";
import { logger } from "../lib/logger.js";

// Reconnect backoff: start at 1s, double per failed attempt, cap at 30s.
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// A stream that survives this long (or delivers a change) is considered
// healthy again and resets the backoff.
const STABLE_RESET_MS = 60_000;

// Tracks whether the change stream is currently open. While it is, the
// watcher is the single source of ticket.created notifications and the
// createTicket route must NOT notify as well (would duplicate).
let watcherActive = false;

export function isTicketWatcherActive() {
    return watcherActive;
}

/**
 * Watches the tickets collection for new inserts via MongoDB Change Stream
 * and triggers all configured notification channels.
 *
 * Requires a MongoDB Replica Set (Atlas always qualifies).
 * The driver auto-resumes the stream after transient connection drops; for
 * non-resumable errors (or an unexpected close) the stream is reopened here
 * with exponential backoff so ticket live notifications recover without a
 * process restart.
 */
export function startTicketWatcher() {
    let attempt = 0;

    const openStream = () => {
        let stream;
        let reconnectScheduled = false;
        let stableTimer = null;

        const scheduleReconnect = (err) => {
            // 'error' is usually followed by 'close' — only schedule once.
            if (reconnectScheduled) return;
            reconnectScheduled = true;
            watcherActive = false;
            if (stableTimer) clearTimeout(stableTimer);

            // Close the broken stream defensively; ignore secondary failures.
            if (stream) {
                stream.close().catch(() => {});
            }

            attempt += 1;
            const delayMs = Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
            logger.warn({ err, attempt, delayMs }, "[TicketWatcher] Change stream lost — scheduling reconnect");
            setTimeout(openStream, delayMs);
        };

        try {
            const collection = mongoose.connection.collection("tickets");
            stream = collection.watch(
                [{ $match: { operationType: "insert" } }],
                { fullDocument: "updateLookup" }
            );
        } catch (err) {
            scheduleReconnect(err);
            return;
        }

        watcherActive = true;

        // Reset the backoff once the stream proves stable.
        stableTimer = setTimeout(() => { attempt = 0; }, STABLE_RESET_MS);

        stream.on("change", (change) => {
            attempt = 0;
            const raw = change.fullDocument;
            if (!raw) return;

            // Normalize raw MongoDB document to the same shape mapTicket() produces
            // so notification services always receive consistent, serializable data.
            const ticket = {
                id: raw._id?.toString(),
                ticket_id: raw.ticket_id,
                ticket_subject: raw.ticket_subject,
                project_id: raw.project_id,
                assigned_member: raw.assigned_member,
                state: raw.state,
                createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : raw.createdAt,
            };

            logger.info(`[TicketWatcher] New ticket detected: #${ticket.ticket_id} — triggering notifications`);
            notifyNewTicket(ticket);
        });

        stream.on("error", (err) => {
            logger.error({ err }, "[TicketWatcher] Change stream error");
            scheduleReconnect(err);
        });

        stream.on("close", () => {
            scheduleReconnect(new Error("change stream closed unexpectedly"));
        });

        logger.info("[TicketWatcher] Watching for new tickets...");
    };

    openStream();
}
