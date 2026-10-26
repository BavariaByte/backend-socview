import express from "express";

// Playbook routes
import listPlaybooks from "./playbooks/listPlaybooks.js";
import createPlaybook from "./playbooks/createPlaybook.js";
import getPlaybook from "./playbooks/getPlaybook.js";
import updatePlaybook from "./playbooks/updatePlaybook.js";
import deletePlaybook from "./playbooks/deletePlaybook.js";
import importPlaybook from "./playbooks/importPlaybook.js";
import smartImport from "./playbooks/smartImport.js";
import exportPlaybook from "./playbooks/exportPlaybook.js";
import listDeletedPlaybooks from "./playbooks/listDeletedPlaybooks.js";
import restorePlaybook from "./playbooks/restorePlaybook.js";
import hardDeletePlaybook from "./playbooks/hardDeletePlaybook.js";
import requireSuperAdmin from "../middleware/requireSuperAdmin.js";

// Settings routes
import getSettings from "./settings/getSettings.js";
import updateSettings from "./settings/updateSettings.js";

const adminRouter = express.Router();

// Playbook management
const playbookRouter = express.Router();
// Use SCOPE instead of Middleware. augmentRoles guarantees mapping.
import { requireScope } from "../middleware/requireScope.js";
import { SCOPES } from "../../../lib/permissions.js";

playbookRouter.use(requireScope(SCOPES.PLAYBOOK_MANAGE));

playbookRouter.get("/", listPlaybooks);
playbookRouter.post("/", createPlaybook);
playbookRouter.get("/deleted", listDeletedPlaybooks);
playbookRouter.post("/:id/restore", restorePlaybook);
playbookRouter.delete("/:id/permanent", requireSuperAdmin, hardDeletePlaybook);
playbookRouter.get("/:id", getPlaybook);
playbookRouter.patch("/:id", updatePlaybook);
playbookRouter.delete("/:id", deletePlaybook);
playbookRouter.post("/smart-import", smartImport);
playbookRouter.post("/:id/import", importPlaybook);
playbookRouter.get("/:id/export", exportPlaybook);

adminRouter.use("/playbooks", playbookRouter);

// Settings (requires admin)
const settingsRouter = express.Router();
settingsRouter.use(requireScope(SCOPES.ADMIN_ACCESS));

settingsRouter.get("/", getSettings);
settingsRouter.patch("/", updateSettings);

adminRouter.use("/settings", settingsRouter);

// API token management
import * as apiTokens from "./apiTokens.js";
const tokenRouter = express.Router();
tokenRouter.use(requireScope(SCOPES.ADMIN_ACCESS));

tokenRouter.get("/", apiTokens.listTokens);
tokenRouter.post("/", apiTokens.createToken);
tokenRouter.patch("/:id", apiTokens.updateToken);
tokenRouter.delete("/:id", apiTokens.deleteToken);

adminRouter.use("/tokens", tokenRouter);

// Platform update check
import updateCheck from "./updateCheck.js";
const updateRouter = express.Router();
updateRouter.use(requireScope(SCOPES.ADMIN_ACCESS));
updateRouter.post("/", updateCheck);
adminRouter.use("/update-check", updateRouter);

export default adminRouter;
