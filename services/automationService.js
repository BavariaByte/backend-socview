
import mongoose from 'mongoose';
import { FormResult, TicketModel, Playbook } from '@girp/database-models';
import { logger } from "../lib/logger.js";

/**
 * Two responsibilities:
 *
 * 1. Retention cleanup — permanently removes soft-deleted tickets and
 *    playbooks (with their versions) older than TICKET_RETENTION_DAYS
 *    (production feature). Playbooks share the ticket retention window
 *    deliberately, so the two trash lifetimes never drift apart.
 *
 * 2. EXPERIMENTAL automation-intent polling — groundwork for playbook
 *    automations. Nothing in the current platform produces intents (the
 *    FormResult schema has no `intents` field) and no UI consumes the
 *    `waiting_for_approval` status yet, so this loop finds no work in
 *    practice. Do not rely on it until the producer and approval flow ship.
 *
 * Resilient against temporary MongoDB connection failures.
 */
export class AutomationService {
    constructor() {
        this.isPolling = false;
        this.pollInterval = 5000; // 5 seconds base interval
        this.maxBackoffMs = 60000; // max 60s backoff on repeated failures
        this.consecutiveErrors = 0;
    }

    startPolling() {
        if (this.isPolling) return;
        this.isPolling = true;
        logger.info('[AutomationService] Started polling for pending intents...');
        this.pollLoop();
        this.scheduleRetentionCleanup();
    }

    scheduleRetentionCleanup() {
        // Run once at startup, then every 24 hours
        this.runRetentionCleanup();
        setInterval(() => this.runRetentionCleanup(), 24 * 60 * 60 * 1000);
    }

    async runRetentionCleanup() {
        if (!this.isMongoConnected()) return;
        try {
            const retentionDays = parseInt(process.env.TICKET_RETENTION_DAYS || '365', 10);
            const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
            const result = await TicketModel.deleteMany({
                deletedAt: { $ne: null, $lt: cutoff }
            });
            if (result.deletedCount > 0) {
                logger.info(`[AutomationService] Permanently removed ${result.deletedCount} ticket(s) past retention period (${retentionDays} days).`);
            }

            const deletedPlaybooks = await Playbook.find({
                deletedAt: { $ne: null, $lt: cutoff }
            }).select('playbookId');

            if (deletedPlaybooks.length > 0) {
                const playbookIds = deletedPlaybooks.map(p => p.playbookId);
                // PlaybookVersion documents are deliberately kept: tickets
                // created from a playbook render their historical questions
                // from those snapshots long after the playbook is gone.
                await Playbook.deleteMany({ playbookId: { $in: playbookIds } });
                logger.info(`[AutomationService] Permanently removed ${playbookIds.length} playbook(s) past retention period (${retentionDays} days); their versions were kept for existing tickets.`);
            }
        } catch (err) {
            logger.error({ err }, '[AutomationService] Retention cleanup failed');
        }
    }

    stopPolling() {
        this.isPolling = false;
    }

    /**
     * Returns true if Mongoose currently has an active connection to MongoDB.
     */
    isMongoConnected() {
        return mongoose.connection.readyState === 1; // 1 = connected
    }

    async pollLoop() {
        while (this.isPolling) {
            if (!this.isMongoConnected()) {
                // MongoDB is not ready — skip this cycle silently
                logger.warn('[AutomationService] MongoDB not connected, skipping poll cycle.');
                await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
                continue;
            }

            try {
                await this.processPendingIntents();
                // Reset backoff on success
                this.consecutiveErrors = 0;
            } catch (error) {
                this.consecutiveErrors++;
                const backoffMs = Math.min(
                    this.pollInterval * Math.pow(2, this.consecutiveErrors - 1),
                    this.maxBackoffMs
                );
                logger.error(
                    { err: error, attempt: this.consecutiveErrors, backoffMs },
                    "[AutomationService] Error in poll loop, backing off"
                );
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
                continue;
            }

            await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
        }
    }

    async processPendingIntents() {
        // Find results with pending intents
        const results = await FormResult.find({
            'intents.status': 'pending'
        }).limit(10);

        for (const result of results) {
            for (const intent of result.intents) {
                if (intent.status === 'pending') {
                    await this.handleIntent(result, intent);
                }
            }
            await result.save();
        }
    }

    async handleIntent(result, intent) {
        logger.info(`[AutomationService] Processing intent ${intent.intent} (ID: ${intent.id})`);

        // 1. Check for "Zero-Touch" (Auto-Execute) intents
        if (intent.intent === 'system:log:event') {
            await this.executeLogEvent(intent);
            intent.status = 'completed';
            intent.executedAt = new Date();
        }
        // 2. High-risk intents are parked for approval. EXPERIMENTAL: no
        //    approval flow consumes this status yet — parked intents stay
        //    parked (see class comment).
        else if (intent.intent === 'system:ad:block_user') {
            intent.status = 'waiting_for_approval';
        }
        else {
            logger.warn(`[AutomationService] Unknown intent: ${intent.intent}`);
            intent.status = 'failed';
            intent.error = 'Unknown intent handler';
        }
    }

    async executeLogEvent(intent) {
        const message = intent.params?.message || 'No message';
        logger.info(`[EXECUTION] logging event: ${message}`);
    }
}

export const automationService = new AutomationService();
