import { logger } from "../../../lib/logger.js";
import { validatePlaybook } from "../../../lib/playbookValidator.js";

/**
 * Validates formDefinition against the playbook schema and sends a 400 response if invalid.
 * Returns true if valid (caller should continue), false if response was already sent.
 *
 * Usage:
 *   const { formDefinition } = req.body;
 *   if (!rejectInvalidPlaybook(formDefinition, res, "[myRoute]")) return;
 */
export function rejectInvalidPlaybook(formDefinition, res, logPrefix = "[playbook-import]") {
    if (!formDefinition) {
        res.status(400).json({ error: "formDefinition is required" });
        return false;
    }

    const validation = validatePlaybook(formDefinition);
    if (!validation.valid) {
        const criticalErrors = validation.errors.filter(e => e.severity === "error");
        logger.warn({ validationErrors: criticalErrors.map(e => `${e.path}: ${e.message}`) }, `${logPrefix} Validation failed`);
        res.status(400).json({
            error: "Playbook JSON validation failed",
            hint: "The JSON contains invalid syntax or potentially dangerous content",
            validationErrors: criticalErrors.map(e => ({ path: e.path, message: e.message })),
            warningCount: validation.errors.filter(e => e.severity === "warning").length
        });
        return false;
    }

    return true;
}
