import { logger } from "../../../lib/logger.js";
import { TicketModel } from "@girp/database-models";
import { mapTicket, parsePagination, parseDateInput, TICKET_STATES } from "./utils.js";

/**
 * GET /api/tickets
 *
 * Query parameters:
 *   - limit (number, optional): Number of entries per page (default 25, max 200)
 *   - offset (number, optional): Number of entries to skip (default 0)
 *   - state (string, optional): Ticketstatus (open, investigation, mitigation, escalated, closed, deferred)
 *   - assignedMember (string, optional): ObjectId of the assigned SOC member
 *   - projectId (string, optional): Project-ID Filter
 *   - createdFrom (string, optional): ISO date (incl. time) as lower bound
 *   - createdTo (string, optional): ISO date (incl. time) as upper bound
 *
 * Request example:
 *   GET /api/tickets?limit=20&state=open&projectId=BREACH
 *
 * Response example:
 * {
 *   "data": [ { "ticket_id": 42, "ticket_subject": "Example" } ],
 *   "pagination": { "total": 120, "limit": 20, "offset": 0 }
 * }
 */
export default async function listTickets(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query);
    const filter = { deletedAt: null };

    if (req.query?.state) {
      if (!TICKET_STATES.includes(req.query.state)) {
        return res.status(400).json({ error: "Invalid state filter" });
      }
      filter.state = req.query.state;
    }

    if (req.query?.assignedMember) {
      if (typeof req.query.assignedMember !== 'string') {
        return res.status(400).json({ error: "Invalid assignedMember filter" });
      }
      filter.assigned_member = req.query.assignedMember;
    }

    if (req.query?.projectId) {
      if (typeof req.query.projectId !== 'string') {
        return res.status(400).json({ error: "Invalid projectId filter" });
      }
      filter.project_id = req.query.projectId;
    }

    const createdFrom = parseDateInput(req.query?.createdFrom);
    const createdTo = parseDateInput(req.query?.createdTo);
    if (req.query?.createdFrom && !createdFrom) {
      return res.status(400).json({ error: "createdFrom must be a valid ISO date" });
    }
    if (req.query?.createdTo && !createdTo) {
      return res.status(400).json({ error: "createdTo must be a valid ISO date" });
    }
    if (createdFrom || createdTo) {
      filter.createdAt = {};
      if (createdFrom) filter.createdAt.$gte = createdFrom;
      if (createdTo) filter.createdAt.$lte = createdTo;
    }

    const [total, tickets] = await Promise.all([
      TicketModel.countDocuments(filter),
      TicketModel.find(filter)
        .skip(offset)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({
          path: 'formResult',
          select: 'playbookId playbookVersion formKey formVersion meta label',
          model: 'FormResult'
        }),
    ]);

    res.json({
      data: tickets.map(mapTicket),
      pagination: { total, limit, offset },
    });
  } catch (error) {
    logger.error({ err: error }, "[GET /api/tickets]");
    res.status(500).json({ error: "Unable to list tickets" });
  }
}
