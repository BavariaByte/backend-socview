import express from "express";
import { requireAuthEither } from "../../lib/auth.combined.js";
import ensureAuthenticatedUser from "./middleware/ensureAuthenticatedUser.js";
import { commentUpload, validateFileHeaders } from "./middleware/upload.js";
import augmentEffectiveRoles from "./middleware/augmentEffectiveRoles.js";
import { requireScope } from "./middleware/requireScope.js";
import { SCOPES } from "../../lib/permissions.js";

// ... imports ...
import listUsers from "./users/listUsers.js";
import createUser from "./users/createUser.js";
import getUser from "./users/getUser.js";
import updateUser from "./users/updateUser.js";
import deleteUser from "./users/deleteUser.js";
import setUserRoles from "./users/setUserRoles.js";
import listTickets from "./tickets/listTickets.js";
import createTicket from "./tickets/createTicket.js";
import getTicket from "./tickets/getTicket.js";
import updateTicket from "./tickets/updateTicket.js";
import deleteTicket from "./tickets/deleteTicket.js";
import addTicketComment from "./tickets/addTicketComment.js";
import uploadTicketAttachment from "./tickets/uploadAttachment.js";
import getTicketTimeline from "./tickets/getTicketTimeline.js";
import listDeletedTickets from "./tickets/listDeletedTickets.js";
import restoreTicket from "./tickets/restoreTicket.js";
import hardDeleteTicket from "./tickets/hardDeleteTicket.js";
import listForms from "./forms/listForms.js";
import listFormResults from "./forms/listFormResults.js";
import createFormResult from "./forms/createFormResult.js";
import getFormResult from "./forms/getFormResult.js";
import updateFormResult from "./forms/updateFormResult.js";
import getCounter from "./counters/getCounter.js";
import incrementCounter from "./counters/incrementCounter.js";
import resetCounter from "./counters/resetCounter.js";
import login from "./auth/login.js";
import logout from "./auth/logout.js";
import getSession from "./auth/getSession.js";
import metrics from "./utility/metrics.js";
import config from "./utility/config.js";
import updateStatus from "./utility/updateStatus.js";
import adminRouter from "./admin/index.js";
import getPlaybookVersion from "./playbooks/getPlaybookVersion.js";
import listPlaybookVersions from "./playbooks/listPlaybookVersions.js";
import downloadCommentFile from "./files/downloadCommentFile.js";
import getUserPreferences from "./users/getUserPreferences.js";
import updateUserPreferences from "./users/updateUserPreferences.js";

const apiRouter = express.Router();

apiRouter.use(requireAuthEither);
apiRouter.use(ensureAuthenticatedUser);
// Calculate effective roles for scope usage
apiRouter.use(augmentEffectiveRoles);

/**
 * Router: /api
 * User, ticket, form, counter, auth and utility endpoints.
 *
 * ensureAuthenticatedUser automatically creates a user record in the DB when
 * needed.
 */
// User endpoints
apiRouter.get("/users", requireScope(SCOPES.USER_READ), listUsers);
apiRouter.post("/users", requireScope(SCOPES.USER_MANAGE), createUser);
apiRouter.get("/users/:id", requireScope(SCOPES.USER_READ), getUser);
apiRouter.patch("/users/:id", requireScope(SCOPES.USER_MANAGE), updateUser);
apiRouter.delete("/users/:id", requireScope(SCOPES.USER_MANAGE), deleteUser);
apiRouter.post("/users/:id/roles", requireScope(SCOPES.USER_MANAGE), setUserRoles);

// Ticket endpoints
apiRouter.get("/tickets", requireScope(SCOPES.TICKET_READ), listTickets);
apiRouter.post("/tickets", requireScope(SCOPES.TICKET_CREATE), createTicket);
// Admin: deleted ticket management (must come before /:id to avoid route shadowing)
apiRouter.get("/tickets/deleted", requireScope(SCOPES.TICKET_DELETE), listDeletedTickets);
apiRouter.post("/tickets/:id/restore", requireScope(SCOPES.TICKET_DELETE), restoreTicket);
apiRouter.delete("/tickets/:id/permanent", requireScope(SCOPES.TICKET_DELETE), hardDeleteTicket);
apiRouter.get("/tickets/:id", requireScope(SCOPES.TICKET_READ), getTicket);
apiRouter.patch("/tickets/:id", requireScope(SCOPES.TICKET_EDIT), updateTicket);
apiRouter.delete("/tickets/:id", requireScope(SCOPES.TICKET_DELETE), deleteTicket);
apiRouter.post("/tickets/:id/comments", requireScope(SCOPES.TICKET_EDIT), commentUpload.array('files', 5), validateFileHeaders, addTicketComment);
apiRouter.post("/tickets/:id/attachments", requireScope(SCOPES.TICKET_EDIT), uploadTicketAttachment);
apiRouter.get("/tickets/:id/timeline", requireScope(SCOPES.TICKET_READ), getTicketTimeline);

// File download endpoints — comment attachments belong to tickets, so
// reading them requires the same scope as reading tickets.
apiRouter.get("/files/comments/:fileId", requireScope(SCOPES.TICKET_READ), downloadCommentFile);

// Form result endpoints
apiRouter.get("/forms", requireScope(SCOPES.FORM_READ), listForms);
apiRouter.get("/forms/:formId/results", requireScope(SCOPES.FORM_READ), listFormResults);
apiRouter.post("/forms/:formId/results", requireScope(SCOPES.FORM_SUBMIT), createFormResult);
apiRouter.get("/forms/:formId/results/:resultId", requireScope(SCOPES.FORM_READ), getFormResult);
apiRouter.patch("/forms/:formId/results/:resultId", requireScope(SCOPES.FORM_SUBMIT), updateFormResult);

// Counter endpoints
apiRouter.get("/counters/:name", requireScope(SCOPES.ADMIN_ACCESS), getCounter);
apiRouter.post("/counters/:name/increment", requireScope(SCOPES.ADMIN_ACCESS), incrementCounter);
apiRouter.patch("/counters/:name/reset", requireScope(SCOPES.ADMIN_ACCESS), resetCounter);

// Auth endpoints
apiRouter.post("/auth/login", login);
apiRouter.post("/auth/logout", logout);
apiRouter.get("/auth/me", getSession);
apiRouter.get("/auth/preferences", getUserPreferences);
apiRouter.put("/auth/preferences", updateUserPreferences);

// Utility endpoints. /api/metrics exposes counter values (same data as the
// admin-gated /api/counters routes), so it requires the same scope.
apiRouter.get("/metrics", requireScope(SCOPES.ADMIN_ACCESS), metrics);
apiRouter.get("/config", config);
apiRouter.get("/update-status", requireScope(SCOPES.ADMIN_ACCESS), updateStatus);

// Playbook version endpoints (for historical question lookup)
apiRouter.get("/playbooks/:playbookId/versions", requireScope(SCOPES.TICKET_READ), listPlaybookVersions);
apiRouter.get("/playbooks/:playbookId/version/:version", requireScope(SCOPES.TICKET_READ), getPlaybookVersion);

// Admin endpoints — adminRouter applies scope middleware (requireScope)
// per sub-router (playbooks, settings, tokens).
apiRouter.use("/admin", adminRouter);

export default apiRouter;
