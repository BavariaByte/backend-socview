/**
 * Playbook JSON Validator
 * 
 * Validates playbook JSON definitions before they are saved to the database
 * and filesystem. Prevents injection attacks (NoSQL, XSS, prototype pollution)
 * and ensures structural integrity.
 * 
 * Based on: docs/playbook_syntax_spec.md
 */

// ───────────────────────────── Constants ─────────────────────────────

const ALLOWED_QUESTION_TYPES = ["textzeile", "textbox", "select", "checkbox", "date", "info", "int"];
const ALLOWED_PROGRESS_MODES = ["step", "percent"];
const ALLOWED_CHECKBOX_ORDERS = ["definition", "alphabetical"];
const ALLOWED_DIV_ZERO = ["error", "skip"];
const ALLOWED_ROUTING_PRIORITY = ["options-first", "actions-first"];
const ALLOWED_EFFECT_ORDER = ["option-action", "action-option"];
const ALLOWED_IMAGE_PLACEMENTS = ["before", "after"];
const ALLOWED_IMAGE_FITS = ["cover", "contain", "fill"];
const ALLOWED_EFFECT_OPS = ["add", "sub", "mul", "div", "set"];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAYBOOK_ID_REGEX = /^[a-z0-9-]+$/;
const LOCALE_REGEX = /^[a-z]{2}-[A-Z]{2}$/;
const VARIABLE_ID_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DATA_URI_REGEX = /^data:image\/(png|jpg|jpeg|gif|webp|svg\+xml);base64,/;
const ASSET_PATH_REGEX = /^assets\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|gif|webp|svg)$/;
const LINK_REF_REGEX = /^@link:[a-z]{2}-[A-Z]{2}$/;

const LIMITS = {
    maxQuestions: 1000,
    maxOptionsPerQuestion: 200,
    maxVariables: 100,
    maxEffectsPerOption: 20,
    maxRoutingRules: 50,
    maxStringLength: 10000,
    maxLabelLength: 1000,
    maxDescriptionLength: 50000,
    maxPlaybookIdLength: 100,
    maxVariableIdLength: 50,
    maxHeight: 2000,
    maxRounding: 10,
    maxAgeMinutes: 525600,
    maxNumericRange: 1000000,
    maxJsonDepth: 15,
};

// Dangerous patterns for injection detection
const DANGEROUS_PATTERNS = [
    /^\$/,                          // NoSQL operators ($gt, $ne, $where, etc.)
    /__proto__/i,                   // Prototype pollution
    /constructor\s*\.\s*prototype/i,// Prototype pollution
    /<script/i,                     // XSS
    /javascript\s*:/i,              // XSS
    /on(error|load|click|mouseover|mouseout|focus|blur|submit|change|input|keydown|keyup|keypress)\s*=/i, // Event handlers
    /eval\s*\(/i,                   // Code injection
    /Function\s*\(/i,              // Code injection
    /require\s*\(/i,               // Module injection
    /import\s*\(/i,                // Module injection
    /process\s*\./i,               // OS command injection
    /child_process/i,              // OS command injection
];

const ALLOWED_ROOT_KEYS = new Set([
    "type", "meta", "i18n", "form", "runtime", "variables",
    "calculation", "flow", "questions", "schemaId", "schemaHash",
    "_nodePositions"
]);

const ALLOWED_META_KEYS = new Set(["id", "version", "title"]);
const ALLOWED_I18N_KEYS = new Set(["defaultLocale", "supported"]);
const ALLOWED_FORM_KEYS = new Set(["title", "description", "progress", "completion"]);
const ALLOWED_PROGRESS_KEYS = new Set(["mode"]);
const ALLOWED_COMPLETION_KEYS = new Set(["title", "description", "summaryEditable"]);
const ALLOWED_RUNTIME_KEYS = new Set(["session"]);
const ALLOWED_SESSION_KEYS = new Set(["identityQuestionId", "resume"]);
const ALLOWED_RESUME_KEYS = new Set(["maxAgeMinutes"]);
const ALLOWED_VARIABLE_KEYS = new Set(["id", "initial"]);
const ALLOWED_CALCULATION_KEYS = new Set(["checkboxOptionOrder", "onDivZero", "rounding", "effectOrder"]);
const ALLOWED_FLOW_KEYS = new Set(["start", "end", "endBehavior", "routingPriority"]);
const ALLOWED_END_BEHAVIOR_KEYS = new Set(["lockAnswers"]);
const ALLOWED_QUESTION_KEYS = new Set([
    "id", "type", "label", "defaultNext", "description", "placeholder",
    "required", "validation", "actions", "image", "system", "options", "effects"
]);
const ALLOWED_OPTION_KEYS = new Set(["id", "label", "value", "next", "effects"]);
const ALLOWED_EFFECT_KEYS = new Set(["var", "op", "value", "lhs", "if"]);
const ALLOWED_ROUTING_KEYS = new Set(["when", "goto", "effects"]);
const ALLOWED_LEAF_CONDITION_KEYS = new Set([
    "var", "questionId",
    "equals", "notEmpty", "isEmpty",
    "contains", "containsAny", "containsAll",
    "gt", "gte", "lt", "lte"
]);
const ALLOWED_COMBINATOR_CONDITION_KEYS = new Set(["anyOf", "allOf", "not"]);
const ALLOWED_IMAGE_KEYS = new Set(["src", "alt", "caption", "placement", "maxHeight", "fit"]);
const ALLOWED_SYSTEM_KEYS = new Set(["isIdentity"]);


// ───────────────────────────── Helpers ─────────────────────────────

class ValidationError {
    constructor(path, message, severity = "error") {
        this.path = path;
        this.message = message;
        this.severity = severity;
    }
}

function checkUnknownKeys(obj, allowedKeys, path, errors) {
    for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
            errors.push(new ValidationError(
                `${path}.${key}`,
                `Unknown field "${key}" is not allowed`,
                "error"
            ));
        }
    }
}

function isSafeString(str, path, errors, maxLen = LIMITS.maxStringLength) {
    if (typeof str !== "string") return false;

    if (str.length > maxLen) {
        errors.push(new ValidationError(path, `String exceeds maximum length of ${maxLen} characters`));
        return false;
    }

    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(str)) {
            errors.push(new ValidationError(path, `Dangerous pattern detected: "${str.substring(0, 50)}..." – possible injection`));
            return false;
        }
    }

    return true;
}

function isValidUUID(str) {
    return typeof str === "string" && UUID_REGEX.test(str);
}

function isValidLocale(str) {
    return typeof str === "string" && LOCALE_REGEX.test(str);
}

function validateI18nObject(obj, path, errors, maxLen = LIMITS.maxLabelLength) {
    if (typeof obj === "string") {
        isSafeString(obj, path, errors, maxLen);
        return;
    }

    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        errors.push(new ValidationError(path, "Must be a string or an object with locale keys"));
        return;
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) {
        errors.push(new ValidationError(path, "i18n object must not be empty"));
        return;
    }

    for (const key of keys) {
        if (!isValidLocale(key)) {
            errors.push(new ValidationError(`${path}.${key}`, `Invalid locale format: "${key}" – expected e.g. "de-DE"`));
        }
        const val = obj[key];
        if (typeof val !== "string") {
            errors.push(new ValidationError(`${path}.${key}`, "Value must be a string"));
        } else if (!LINK_REF_REGEX.test(val)) {
            isSafeString(val, `${path}.${key}`, errors, maxLen);
        }
    }
}

function isValidQuestionRef(ref, questionIds) {
    return ref === "submit" || questionIds.has(ref);
}

function checkJsonDepth(obj, depth = 0, maxDepth = LIMITS.maxJsonDepth) {
    if (depth > maxDepth) return false;
    if (typeof obj !== "object" || obj === null) return true;

    for (const val of Object.values(obj)) {
        if (!checkJsonDepth(val, depth + 1, maxDepth)) return false;
    }
    return true;
}


// ───────────────────────── Section Validators ─────────────────────────

function validateMeta(meta, errors) {
    const path = "meta";
    if (typeof meta !== "object" || meta === null) {
        errors.push(new ValidationError(path, "meta must be an object"));
        return;
    }
    checkUnknownKeys(meta, ALLOWED_META_KEYS, path, errors);

    // meta.id
    if (!meta.id || typeof meta.id !== "string") {
        errors.push(new ValidationError(`${path}.id`, "meta.id is required and must be a string"));
    } else if (!PLAYBOOK_ID_REGEX.test(meta.id)) {
        errors.push(new ValidationError(`${path}.id`, "meta.id may only contain lowercase letters, digits, and hyphens"));
    } else if (meta.id.length > LIMITS.maxPlaybookIdLength) {
        errors.push(new ValidationError(`${path}.id`, `meta.id may be at most ${LIMITS.maxPlaybookIdLength} characters long`));
    }

    // meta.version
    if (meta.version === undefined || meta.version === null) {
        errors.push(new ValidationError(`${path}.version`, "meta.version is required"));
    } else {
        const v = parseInt(String(meta.version), 10);
        if (isNaN(v) || v < 1) {
            errors.push(new ValidationError(`${path}.version`, "meta.version must be a positive number (given as a string)"));
        }
    }

    // meta.title (optional)
    if (meta.title !== undefined) {
        if (typeof meta.title === "string") {
            isSafeString(meta.title, `${path}.title`, errors, LIMITS.maxLabelLength);
        } else if (typeof meta.title === "object" && meta.title !== null) {
            validateI18nObject(meta.title, `${path}.title`, errors, LIMITS.maxLabelLength);
        } else {
            errors.push(new ValidationError(`${path}.title`, "meta.title must be a string or an i18n object"));
        }
    }
}

function validateI18nConfig(i18n, errors) {
    const path = "i18n";
    if (typeof i18n !== "object" || i18n === null) {
        errors.push(new ValidationError(path, "i18n must be an object"));
        return;
    }
    checkUnknownKeys(i18n, ALLOWED_I18N_KEYS, path, errors);

    if (!i18n.defaultLocale || !isValidLocale(i18n.defaultLocale)) {
        errors.push(new ValidationError(`${path}.defaultLocale`, "defaultLocale is required and must be in xx-XX format"));
    }

    if (!Array.isArray(i18n.supported) || i18n.supported.length === 0) {
        errors.push(new ValidationError(`${path}.supported`, "supported must be an array with at least one locale"));
    } else {
        for (let i = 0; i < i18n.supported.length; i++) {
            if (!isValidLocale(i18n.supported[i])) {
                errors.push(new ValidationError(`${path}.supported[${i}]`, `Invalid locale format: "${i18n.supported[i]}"`));
            }
        }
        if (i18n.defaultLocale && !i18n.supported.includes(i18n.defaultLocale)) {
            errors.push(new ValidationError(`${path}.defaultLocale`, "defaultLocale must be included in supported"));
        }
    }
}

function validateForm(form, errors) {
    const path = "form";
    if (typeof form !== "object" || form === null) {
        errors.push(new ValidationError(path, "form must be an object"));
        return;
    }
    checkUnknownKeys(form, ALLOWED_FORM_KEYS, path, errors);

    if (form.title !== undefined) validateI18nObject(form.title, `${path}.title`, errors);
    if (form.description !== undefined) validateI18nObject(form.description, `${path}.description`, errors, LIMITS.maxDescriptionLength);

    if (form.progress !== undefined) {
        if (typeof form.progress !== "object" || form.progress === null) {
            errors.push(new ValidationError(`${path}.progress`, "progress must be an object"));
        } else {
            checkUnknownKeys(form.progress, ALLOWED_PROGRESS_KEYS, `${path}.progress`, errors);
            if (!form.progress.mode || !ALLOWED_PROGRESS_MODES.includes(form.progress.mode)) {
                errors.push(new ValidationError(`${path}.progress.mode`, `mode must be one of: ${ALLOWED_PROGRESS_MODES.join(", ")}`));
            }
        }
    }

    if (form.completion !== undefined) {
        if (typeof form.completion !== "object" || form.completion === null) {
            errors.push(new ValidationError(`${path}.completion`, "completion must be an object"));
        } else {
            checkUnknownKeys(form.completion, ALLOWED_COMPLETION_KEYS, `${path}.completion`, errors);
            if (form.completion.title !== undefined) validateI18nObject(form.completion.title, `${path}.completion.title`, errors);
            if (form.completion.description !== undefined) validateI18nObject(form.completion.description, `${path}.completion.description`, errors, LIMITS.maxDescriptionLength);
            if (form.completion.summaryEditable !== undefined && typeof form.completion.summaryEditable !== "boolean") {
                errors.push(new ValidationError(`${path}.completion.summaryEditable`, "summaryEditable must be a boolean"));
            }
        }
    }
}

function validateRuntime(runtime, errors) {
    const path = "runtime";
    if (typeof runtime !== "object" || runtime === null) {
        errors.push(new ValidationError(path, "runtime must be an object"));
        return;
    }
    checkUnknownKeys(runtime, ALLOWED_RUNTIME_KEYS, path, errors);

    // session
    if (runtime.session !== undefined) {
        const sp = `${path}.session`;
        if (typeof runtime.session !== "object" || runtime.session === null) {
            errors.push(new ValidationError(sp, "session must be an object"));
        } else {
            checkUnknownKeys(runtime.session, ALLOWED_SESSION_KEYS, sp, errors);
            if (runtime.session.identityQuestionId !== undefined) {
                if (!isValidUUID(runtime.session.identityQuestionId)) {
                    errors.push(new ValidationError(`${sp}.identityQuestionId`, "identityQuestionId must be a valid UUID"));
                }
            }
            if (runtime.session.resume !== undefined) {
                const rp = `${sp}.resume`;
                if (typeof runtime.session.resume !== "object" || runtime.session.resume === null) {
                    errors.push(new ValidationError(rp, "resume must be an object"));
                } else {
                    checkUnknownKeys(runtime.session.resume, ALLOWED_RESUME_KEYS, rp, errors);
                    if (runtime.session.resume.sameBrowserOnly !== undefined && typeof runtime.session.resume.sameBrowserOnly !== "boolean") {
                        errors.push(new ValidationError(`${rp}.sameBrowserOnly`, "sameBrowserOnly must be a boolean"));
                    }
                    if (runtime.session.resume.maxAgeMinutes !== undefined) {
                        if (typeof runtime.session.resume.maxAgeMinutes !== "number" || runtime.session.resume.maxAgeMinutes < 1 || runtime.session.resume.maxAgeMinutes > LIMITS.maxAgeMinutes) {
                            errors.push(new ValidationError(`${rp}.maxAgeMinutes`, `maxAgeMinutes must be between 1 and ${LIMITS.maxAgeMinutes}`));
                        }
                    }
                }
            }
        }
    }

}

function validateVariables(variables, errors) {
    const path = "variables";
    if (!Array.isArray(variables)) {
        errors.push(new ValidationError(path, "variables must be an array"));
        return;
    }
    if (variables.length > LIMITS.maxVariables) {
        errors.push(new ValidationError(path, `At most ${LIMITS.maxVariables} variables allowed`));
    }

    const varIds = new Set();
    for (let i = 0; i < variables.length; i++) {
        const v = variables[i];
        const vp = `${path}[${i}]`;

        if (typeof v !== "object" || v === null) {
            errors.push(new ValidationError(vp, "Variable must be an object"));
            continue;
        }
        checkUnknownKeys(v, ALLOWED_VARIABLE_KEYS, vp, errors);

        if (!v.id || typeof v.id !== "string") {
            errors.push(new ValidationError(`${vp}.id`, "Variable id is required"));
        } else if (!VARIABLE_ID_REGEX.test(v.id)) {
            errors.push(new ValidationError(`${vp}.id`, "Variable id may only contain letters, digits, and underscores (must start with a letter or underscore)"));
        } else if (v.id.length > LIMITS.maxVariableIdLength) {
            errors.push(new ValidationError(`${vp}.id`, `Variable id may be at most ${LIMITS.maxVariableIdLength} characters long`));
        } else {
            if (varIds.has(v.id)) {
                errors.push(new ValidationError(`${vp}.id`, `Duplicate variable id: "${v.id}"`));
            }
            varIds.add(v.id);
        }

        if (v.initial === undefined || typeof v.initial !== "number") {
            errors.push(new ValidationError(`${vp}.initial`, "Variable initial must be a number"));
        }
    }
}

function validateCalculation(calculation, errors) {
    const path = "calculation";
    if (typeof calculation !== "object" || calculation === null) {
        errors.push(new ValidationError(path, "calculation must be an object"));
        return;
    }
    checkUnknownKeys(calculation, ALLOWED_CALCULATION_KEYS, path, errors);

    if (calculation.checkboxOptionOrder !== undefined && !ALLOWED_CHECKBOX_ORDERS.includes(calculation.checkboxOptionOrder)) {
        errors.push(new ValidationError(`${path}.checkboxOptionOrder`, `checkboxOptionOrder must be one of: ${ALLOWED_CHECKBOX_ORDERS.join(", ")}`));
    }
    if (calculation.onDivZero !== undefined && !ALLOWED_DIV_ZERO.includes(calculation.onDivZero)) {
        errors.push(new ValidationError(`${path}.onDivZero`, `onDivZero must be one of: ${ALLOWED_DIV_ZERO.join(", ")}`));
    }
    if (calculation.rounding !== undefined) {
        if (typeof calculation.rounding !== "number" || calculation.rounding < 0 || calculation.rounding > LIMITS.maxRounding) {
            errors.push(new ValidationError(`${path}.rounding`, `rounding must be between 0 and ${LIMITS.maxRounding}`));
        }
    }
    if (calculation.effectOrder !== undefined && !ALLOWED_EFFECT_ORDER.includes(calculation.effectOrder)) {
        errors.push(new ValidationError(`${path}.effectOrder`, `effectOrder must be one of: ${ALLOWED_EFFECT_ORDER.join(", ")}`));
    }
}

function validateFlow(flow, questionIds, errors) {
    const path = "flow";
    if (typeof flow !== "object" || flow === null) {
        errors.push(new ValidationError(path, "flow must be an object"));
        return;
    }
    checkUnknownKeys(flow, ALLOWED_FLOW_KEYS, path, errors);

    // start
    if (flow.start === undefined) {
        errors.push(new ValidationError(`${path}.start`, "flow.start is required"));
    } else if (flow.start !== "" && !isValidQuestionRef(flow.start, questionIds)) {
        errors.push(new ValidationError(`${path}.start`, `flow.start references an invalid question ID: "${flow.start}"`));
    }

    // end
    if (flow.end !== "submit") {
        errors.push(new ValidationError(`${path}.end`, 'flow.end must be "submit"'));
    }

    // routingPriority
    if (flow.routingPriority !== undefined && !ALLOWED_ROUTING_PRIORITY.includes(flow.routingPriority)) {
        errors.push(new ValidationError(`${path}.routingPriority`, `routingPriority must be one of: ${ALLOWED_ROUTING_PRIORITY.join(", ")}`));
    }

    // endBehavior
    if (flow.endBehavior !== undefined) {
        if (typeof flow.endBehavior !== "object" || flow.endBehavior === null) {
            errors.push(new ValidationError(`${path}.endBehavior`, "endBehavior must be an object"));
        } else {
            checkUnknownKeys(flow.endBehavior, ALLOWED_END_BEHAVIOR_KEYS, `${path}.endBehavior`, errors);
            if (flow.endBehavior.lockAnswers !== undefined && typeof flow.endBehavior.lockAnswers !== "boolean") {
                errors.push(new ValidationError(`${path}.endBehavior.lockAnswers`, "lockAnswers must be a boolean"));
            }
        }
    }
}


function validateImage(image, path, errors) {
    if (typeof image !== "object" || image === null) {
        errors.push(new ValidationError(path, "image must be an object"));
        return;
    }
    checkUnknownKeys(image, ALLOWED_IMAGE_KEYS, path, errors);

    // src (required)
    if (!image.src || typeof image.src !== "object") {
        errors.push(new ValidationError(`${path}.src`, "image.src is required and must be an i18n object"));
    } else {
        for (const [locale, val] of Object.entries(image.src)) {
            if (!isValidLocale(locale)) {
                errors.push(new ValidationError(`${path}.src.${locale}`, `Invalid locale: "${locale}"`));
                continue;
            }
            if (typeof val !== "string") {
                errors.push(new ValidationError(`${path}.src.${locale}`, "Value must be a string"));
                continue;
            }
            // Validate src value: asset path, data URI, @link reference, or empty string
            if (val === "") continue; // Empty string is allowed (placeholder)
            if (LINK_REF_REGEX.test(val)) continue;
            if (DATA_URI_REGEX.test(val)) continue; // Base64 data – don't apply injection checks
            if (ASSET_PATH_REGEX.test(val)) continue;

            // If none matched, reject
            if (val.includes("..") || val.startsWith("/") || val.startsWith("\\")) {
                errors.push(new ValidationError(`${path}.src.${locale}`, "Path traversal detected – absolute or relative paths are not allowed"));
            } else {
                // Allow but warn – could be a custom path format
                errors.push(new ValidationError(`${path}.src.${locale}`, `Invalid image path: "${val.substring(0, 50)}" – allowed: assets/file.ext, data:image/..., @link:xx-XX`, "warning"));
            }
        }
    }

    // alt (optional)
    if (image.alt !== undefined) validateI18nObject(image.alt, `${path}.alt`, errors);

    // caption (optional)
    if (image.caption !== undefined) {
        if (typeof image.caption !== "string") {
            errors.push(new ValidationError(`${path}.caption`, "caption must be a string"));
        } else {
            isSafeString(image.caption, `${path}.caption`, errors, LIMITS.maxLabelLength);
        }
    }

    // placement (optional)
    if (image.placement !== undefined && !ALLOWED_IMAGE_PLACEMENTS.includes(image.placement)) {
        errors.push(new ValidationError(`${path}.placement`, `placement must be one of: ${ALLOWED_IMAGE_PLACEMENTS.join(", ")}`));
    }

    // maxHeight (optional)
    if (image.maxHeight !== undefined) {
        if (typeof image.maxHeight !== "number" || image.maxHeight < 1 || image.maxHeight > LIMITS.maxHeight) {
            errors.push(new ValidationError(`${path}.maxHeight`, `maxHeight must be between 1 and ${LIMITS.maxHeight}`));
        }
    }

    // fit (optional)
    if (image.fit !== undefined && !ALLOWED_IMAGE_FITS.includes(image.fit)) {
        errors.push(new ValidationError(`${path}.fit`, `fit must be one of: ${ALLOWED_IMAGE_FITS.join(", ")}`));
    }
}

function validateEffects(effects, path, errors, variableIds = []) {
    if (!Array.isArray(effects)) {
        errors.push(new ValidationError(path, "effects must be an array"));
        return;
    }
    if (effects.length > LIMITS.maxEffectsPerOption) {
        errors.push(new ValidationError(path, `At most ${LIMITS.maxEffectsPerOption} effects per option allowed`));
    }

    for (let i = 0; i < effects.length; i++) {
        const e = effects[i];
        const ep = `${path}[${i}]`;

        if (typeof e !== "object" || e === null) {
            errors.push(new ValidationError(ep, "Effect must be an object"));
            continue;
        }
        checkUnknownKeys(e, ALLOWED_EFFECT_KEYS, ep, errors);

        if (!e.var || typeof e.var !== "string") {
            errors.push(new ValidationError(`${ep}.var`, "var is required and must be a string"));
        } else {
            isSafeString(e.var, `${ep}.var`, errors, LIMITS.maxVariableIdLength);
        }

        if (!e.op || !ALLOWED_EFFECT_OPS.includes(e.op)) {
            errors.push(new ValidationError(`${ep}.op`, `op must be one of: ${ALLOWED_EFFECT_OPS.join(", ")}`));
        }

        if (e.value === undefined) {
            errors.push(new ValidationError(`${ep}.value`, "value is required"));
        }
        // $-prefixed strings are valid variable references (e.g. "$score") — NOT subject to
        // isSafeString() since DANGEROUS_PATTERNS includes /^\$/ for NoSQL injection prevention.
        // Validation is handled explicitly below.
        else if (typeof e.value === "string") {
            if (!e.value.startsWith("$")) {
                errors.push(new ValidationError(`${ep}.value`, 'Variable reference must start with "$" (e.g. "$score")'));
            } else {
                const refId = e.value.slice(1);
                if (!VARIABLE_ID_REGEX.test(refId)) {
                    errors.push(new ValidationError(`${ep}.value`, `"${e.value}" is not a valid variable reference`));
                } else if (variableIds.length > 0 && !variableIds.includes(refId)) {
                    errors.push(new ValidationError(`${ep}.value`, `Variable reference "${e.value}" references an undeclared variable`));
                }
            }
        } else if (typeof e.value !== "number") {
            errors.push(new ValidationError(`${ep}.value`, 'value must be a number or a variable reference (e.g. "$score")'));
        }

        // lhs (optional) — only set in function mode
        if (e.lhs !== undefined) {
            if (typeof e.lhs !== "string" || !VARIABLE_ID_REGEX.test(e.lhs)) {
                errors.push(new ValidationError(`${ep}.lhs`, 'lhs must be a valid variable ID (e.g. "score")'));
            } else if (variableIds.length > 0 && !variableIds.includes(e.lhs)) {
                errors.push(new ValidationError(`${ep}.lhs`, `lhs "${e.lhs}" references an undeclared variable`));
            }
            // In function mode (lhs set), value is always a variable reference.
            // Literals are deliberately not allowed in function mode:
            // standard mode should be used for "var = lhs op literal".
            if (typeof e.value !== "string" || !e.value.startsWith("$")) {
                errors.push(new ValidationError(`${ep}.value`, 'In function mode (lhs set), value must be a variable reference (e.g. "$score")'));
            }
        }

        if (e.if !== undefined) {
            validateCondition(e.if, `${ep}.if`, errors);
        }
    }
}

function validateCondition(condition, path, errors, depth = 0) {
    if (typeof condition !== "object" || condition === null) {
        errors.push(new ValidationError(path, "Condition must be an object"));
        return;
    }
    if (depth > 5) {
        errors.push(new ValidationError(path, "Condition is nested too deeply (max. 5 levels)"));
        return;
    }

    const keys = Object.keys(condition);
    const isCombinator = keys.some(k => ALLOWED_COMBINATOR_CONDITION_KEYS.has(k));

    if (isCombinator) {
        for (const key of keys) {
            if (!ALLOWED_COMBINATOR_CONDITION_KEYS.has(key)) {
                errors.push(new ValidationError(`${path}.${key}`, `Unknown field "${key}" in combinator condition`));
            }
        }
        if (condition.anyOf !== undefined) {
            if (!Array.isArray(condition.anyOf) || condition.anyOf.length === 0) {
                errors.push(new ValidationError(`${path}.anyOf`, "anyOf must be a non-empty array"));
            } else {
                condition.anyOf.forEach((c, i) => validateCondition(c, `${path}.anyOf[${i}]`, errors, depth + 1));
            }
        }
        if (condition.allOf !== undefined) {
            if (!Array.isArray(condition.allOf) || condition.allOf.length === 0) {
                errors.push(new ValidationError(`${path}.allOf`, "allOf must be a non-empty array"));
            } else {
                condition.allOf.forEach((c, i) => validateCondition(c, `${path}.allOf[${i}]`, errors, depth + 1));
            }
        }
        if (condition.not !== undefined) {
            validateCondition(condition.not, `${path}.not`, errors, depth + 1);
        }
    } else {
        // Leaf condition
        for (const key of keys) {
            if (!ALLOWED_LEAF_CONDITION_KEYS.has(key)) {
                errors.push(new ValidationError(`${path}.${key}`, `Unknown field "${key}" in condition`));
            }
        }

        if (condition.var !== undefined) {
            if (typeof condition.var !== "string" || !condition.var) {
                errors.push(new ValidationError(`${path}.var`, "var must be a non-empty string"));
            } else {
                isSafeString(condition.var, `${path}.var`, errors, LIMITS.maxVariableIdLength);
            }
        }
        if (condition.questionId !== undefined) {
            if (!isValidUUID(condition.questionId)) {
                errors.push(new ValidationError(`${path}.questionId`, "questionId must be a valid UUID"));
            }
        }
        if (condition.equals !== undefined) {
            if (typeof condition.equals !== "string" && typeof condition.equals !== "number" && typeof condition.equals !== "boolean") {
                errors.push(new ValidationError(`${path}.equals`, "equals must be a string, a number, or a boolean"));
            }
        }
        if (condition.notEmpty !== undefined && typeof condition.notEmpty !== "boolean") {
            errors.push(new ValidationError(`${path}.notEmpty`, "notEmpty must be a boolean"));
        }
        if (condition.isEmpty !== undefined && typeof condition.isEmpty !== "boolean") {
            errors.push(new ValidationError(`${path}.isEmpty`, "isEmpty must be a boolean"));
        }
        if (condition.contains !== undefined) {
            if (typeof condition.contains !== "string") {
                errors.push(new ValidationError(`${path}.contains`, "contains must be a string"));
            } else {
                isSafeString(condition.contains, `${path}.contains`, errors);
            }
        }
        if (condition.containsAny !== undefined) {
            if (!Array.isArray(condition.containsAny) || !condition.containsAny.every(v => typeof v === "string")) {
                errors.push(new ValidationError(`${path}.containsAny`, "containsAny must be an array of strings"));
            }
        }
        if (condition.containsAll !== undefined) {
            if (!Array.isArray(condition.containsAll) || !condition.containsAll.every(v => typeof v === "string")) {
                errors.push(new ValidationError(`${path}.containsAll`, "containsAll must be an array of strings"));
            }
        }
        if (condition.gt !== undefined && typeof condition.gt !== "number") {
            errors.push(new ValidationError(`${path}.gt`, "gt must be a number"));
        }
        if (condition.gte !== undefined && typeof condition.gte !== "number") {
            errors.push(new ValidationError(`${path}.gte`, "gte must be a number"));
        }
        if (condition.lt !== undefined && typeof condition.lt !== "number") {
            errors.push(new ValidationError(`${path}.lt`, "lt must be a number"));
        }
        if (condition.lte !== undefined && typeof condition.lte !== "number") {
            errors.push(new ValidationError(`${path}.lte`, "lte must be a number"));
        }
    }
}

function validateRouting(routing, path, questionIds, errors, variableIds = []) {
    if (!Array.isArray(routing)) {
        errors.push(new ValidationError(path, "actions must be an array"));
        return;
    }
    if (routing.length > LIMITS.maxRoutingRules) {
        errors.push(new ValidationError(path, `At most ${LIMITS.maxRoutingRules} actions allowed`));
    }

    for (let i = 0; i < routing.length; i++) {
        const r = routing[i];
        const rp = `${path}[${i}]`;

        if (typeof r !== "object" || r === null) {
            errors.push(new ValidationError(rp, "Action must be an object"));
            continue;
        }
        checkUnknownKeys(r, ALLOWED_ROUTING_KEYS, rp, errors);

        // when
        if (!r.when || typeof r.when !== "object") {
            errors.push(new ValidationError(`${rp}.when`, "when is required and must be an object"));
        } else {
            validateCondition(r.when, `${rp}.when`, errors);
        }

        // goto (optional — actions without goto are effect-only)
        if (r.goto !== undefined) {
            if (typeof r.goto !== "string") {
                errors.push(new ValidationError(`${rp}.goto`, "goto must be a string"));
            } else if (!isValidQuestionRef(r.goto, questionIds)) {
                errors.push(new ValidationError(`${rp}.goto`, `goto references an invalid question ID: "${r.goto}"`));
            }
        }

        // effects (optional)
        if (r.effects !== undefined) {
            validateEffects(r.effects, `${rp}.effects`, errors, variableIds);
        }
    }
}

function validateOptions(options, path, questionIds, errors, variableIds = []) {
    if (!Array.isArray(options)) {
        errors.push(new ValidationError(path, "options must be an array"));
        return;
    }
    if (options.length === 0) {
        errors.push(new ValidationError(path, "options must contain at least one option"));
    }
    if (options.length > LIMITS.maxOptionsPerQuestion) {
        errors.push(new ValidationError(path, `At most ${LIMITS.maxOptionsPerQuestion} options per question allowed`));
    }

    const optionValues = new Set();

    for (let i = 0; i < options.length; i++) {
        const o = options[i];
        const op = `${path}[${i}]`;

        if (typeof o !== "object" || o === null) {
            errors.push(new ValidationError(op, "Option must be an object"));
            continue;
        }
        checkUnknownKeys(o, ALLOWED_OPTION_KEYS, op, errors);

        // id (optional — exporter strips it; validate if present)
        if (o.id !== undefined) {
            if (typeof o.id !== "string") {
                errors.push(new ValidationError(`${op}.id`, "Option id must be a string"));
            } else if (!isValidUUID(o.id)) {
                isSafeString(o.id, `${op}.id`, errors, 100);
                errors.push(new ValidationError(`${op}.id`, `Not a UUID: "${o.id}"`, "warning"));
            }
        }

        // label
        if (!o.label) {
            errors.push(new ValidationError(`${op}.label`, "Option label is required"));
        } else {
            validateI18nObject(o.label, `${op}.label`, errors);
        }

        // value
        if (o.value === undefined || typeof o.value !== "string") {
            errors.push(new ValidationError(`${op}.value`, "Option value is required and must be a string"));
        } else {
            isSafeString(o.value, `${op}.value`, errors, 500);
            if (optionValues.has(o.value)) {
                errors.push(new ValidationError(`${op}.value`, `Duplicate option value: "${o.value}"`));
            }
            optionValues.add(o.value);
        }

        // next (optional)
        if (o.next !== undefined) {
            if (typeof o.next !== "string") {
                errors.push(new ValidationError(`${op}.next`, "next must be a string"));
            } else if (!isValidQuestionRef(o.next, questionIds)) {
                errors.push(new ValidationError(`${op}.next`, `next references an invalid question ID: "${o.next}"`));
            }
        }

        // effects (optional)
        if (o.effects !== undefined) {
            validateEffects(o.effects, `${op}.effects`, errors, variableIds);
        }
    }
}

function validateValidation(validation, questionType, path, errors) {
    if (typeof validation !== "object" || validation === null) {
        errors.push(new ValidationError(path, "validation must be an object"));
        return;
    }

    const textTypes = ["textzeile", "textbox"];
    const dateTypes = ["date"];
    const numberTypes = ["int"];
    const checkboxTypes = ["checkbox"];

    for (const key of Object.keys(validation)) {
        if (key === "minLength" || key === "maxLength" || key === "pattern") {
            if (!textTypes.includes(questionType)) {
                errors.push(new ValidationError(`${path}.${key}`, `${key} is only allowed for text types, not for "${questionType}"`));
            }
            if (key === "minLength" || key === "maxLength") {
                if (typeof validation[key] !== "number" || validation[key] < 0) {
                    errors.push(new ValidationError(`${path}.${key}`, `${key} must be a positive number`));
                }
            }
            if (key === "pattern" && typeof validation[key] !== "string") {
                errors.push(new ValidationError(`${path}.${key}`, "pattern must be a string"));
            } else if (key === "pattern") {
                isSafeString(validation[key], `${path}.${key}`, errors);
            }
        } else if (key === "min" || key === "max") {
            if (!dateTypes.includes(questionType) && !numberTypes.includes(questionType)) {
                errors.push(new ValidationError(`${path}.${key}`, `${key} is only allowed for date/int types, not for "${questionType}"`));
            }
            if (dateTypes.includes(questionType) && typeof validation[key] !== "string") {
                errors.push(new ValidationError(`${path}.${key}`, `${key} must be a string for date questions`));
            } else if (dateTypes.includes(questionType)) {
                isSafeString(validation[key], `${path}.${key}`, errors, 100);
            }
            if (numberTypes.includes(questionType) && typeof validation[key] !== "number") {
                errors.push(new ValidationError(`${path}.${key}`, `${key} must be a number for int questions`));
            }
        } else if (key === "maxSelections") {
            if (!checkboxTypes.includes(questionType)) {
                errors.push(new ValidationError(`${path}.${key}`, `maxSelections is only allowed for checkbox, not for "${questionType}"`));
            }
            if (typeof validation[key] !== "number" || validation[key] < 1) {
                errors.push(new ValidationError(`${path}.${key}`, "maxSelections must be a positive number >= 1"));
            }
        } else {
            errors.push(new ValidationError(`${path}.${key}`, `Unknown validation rule: "${key}"`));
        }
    }
}

function validateQuestions(questions, errors, variableIds = []) {
    const path = "questions";
    if (!Array.isArray(questions)) {
        errors.push(new ValidationError(path, "questions must be an array"));
        return new Set();
    }
    if (questions.length > LIMITS.maxQuestions) {
        errors.push(new ValidationError(path, `At most ${LIMITS.maxQuestions} questions allowed`));
    }

    // First pass: collect all IDs
    const questionIds = new Set();
    for (const q of questions) {
        if (q && typeof q.id === "string") {
            questionIds.add(q.id);
        }
    }

    // Second pass: full validation
    const seenIds = new Set();
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qp = `${path}[${i}]`;

        if (typeof q !== "object" || q === null) {
            errors.push(new ValidationError(qp, "Question must be an object"));
            continue;
        }
        checkUnknownKeys(q, ALLOWED_QUESTION_KEYS, qp, errors);

        // id
        if (!q.id || typeof q.id !== "string") {
            errors.push(new ValidationError(`${qp}.id`, "Question id is required"));
        } else if (!isValidUUID(q.id)) {
            errors.push(new ValidationError(`${qp}.id`, `Invalid UUID: "${q.id}"`));
        } else {
            if (seenIds.has(q.id)) {
                errors.push(new ValidationError(`${qp}.id`, `Duplicate question id: "${q.id}"`));
            }
            seenIds.add(q.id);
        }

        // type
        if (!q.type || !ALLOWED_QUESTION_TYPES.includes(q.type)) {
            errors.push(new ValidationError(`${qp}.type`, `type must be one of: ${ALLOWED_QUESTION_TYPES.join(", ")} (found: "${q.type}")`));
        }

        // label
        if (!q.label) {
            errors.push(new ValidationError(`${qp}.label`, "label is missing – the question ID will be shown as a fallback label", "warning"));
        } else {
            validateI18nObject(q.label, `${qp}.label`, errors);
        }

        // defaultNext
        if (!q.defaultNext && q.defaultNext !== "") {
            errors.push(new ValidationError(`${qp}.defaultNext`, "defaultNext is required"));
        } else if (typeof q.defaultNext !== "string") {
            errors.push(new ValidationError(`${qp}.defaultNext`, "defaultNext must be a string"));
        } else if (!isValidQuestionRef(q.defaultNext, questionIds)) {
            errors.push(new ValidationError(`${qp}.defaultNext`, `defaultNext references an invalid question ID: "${q.defaultNext}"`));
        }

        // description (optional)
        if (q.description !== undefined) {
            if (typeof q.description === "string") {
                isSafeString(q.description, `${qp}.description`, errors, LIMITS.maxDescriptionLength);
            } else if (typeof q.description === "object" && q.description !== null) {
                validateI18nObject(q.description, `${qp}.description`, errors, LIMITS.maxDescriptionLength);
            } else {
                errors.push(new ValidationError(`${qp}.description`, "description must be a string or an i18n object"));
            }
        }

        // placeholder (optional)
        if (q.placeholder !== undefined) {
            validateI18nObject(q.placeholder, `${qp}.placeholder`, errors);
        }

        // required (optional)
        if (q.required !== undefined && typeof q.required !== "boolean") {
            errors.push(new ValidationError(`${qp}.required`, "required must be a boolean"));
        }

        // validation (optional)
        if (q.validation !== undefined) {
            validateValidation(q.validation, q.type, `${qp}.validation`, errors);
        }

        // options – required for select/checkbox
        if (q.type === "select" || q.type === "checkbox") {
            if (!q.options) {
                errors.push(new ValidationError(`${qp}.options`, `options is required for type "${q.type}"`));
            } else {
                validateOptions(q.options, `${qp}.options`, questionIds, errors, variableIds);
            }
        } else if (q.options !== undefined) {
            errors.push(new ValidationError(`${qp}.options`, `options is not allowed for type "${q.type}"`, "warning"));
        }

        // actions (optional)
        if (q.actions !== undefined) {
            validateRouting(q.actions, `${qp}.actions`, questionIds, errors, variableIds);
        }

        // effects (optional – directly on question, e.g. for info questions setting variables)
        if (q.effects !== undefined) {
            validateEffects(q.effects, `${qp}.effects`, errors, variableIds);
        }

        // image (optional)
        if (q.image !== undefined) {
            validateImage(q.image, `${qp}.image`, errors);
        }

        // system (optional)
        if (q.system !== undefined) {
            if (typeof q.system !== "object" || q.system === null) {
                errors.push(new ValidationError(`${qp}.system`, "system must be an object"));
            } else {
                checkUnknownKeys(q.system, ALLOWED_SYSTEM_KEYS, `${qp}.system`, errors);
                if (q.system.isIdentity !== undefined && typeof q.system.isIdentity !== "boolean") {
                    errors.push(new ValidationError(`${qp}.system.isIdentity`, "isIdentity must be a boolean"));
                }
            }
        }
    }

    return questionIds;
}


// ───────────────────────── Main Validator ─────────────────────────

/**
 * Validates a complete playbook JSON definition.
 * 
 * @param {object} playbook - The playbook JSON object to validate
 * @returns {{ valid: boolean, errors: Array<{path: string, message: string, severity: string}> }}
 */
export function validatePlaybook(playbook) {
    const errors = [];

    // Basic type check
    if (typeof playbook !== "object" || playbook === null || Array.isArray(playbook)) {
        errors.push(new ValidationError("root", "Playbook must be a JSON object"));
        return { valid: false, errors };
    }

    // JSON depth check
    if (!checkJsonDepth(playbook)) {
        errors.push(new ValidationError("root", `JSON nesting exceeds the maximum depth of ${LIMITS.maxJsonDepth}`));
        return { valid: false, errors };
    }

    // Root level
    checkUnknownKeys(playbook, ALLOWED_ROOT_KEYS, "root", errors);

    // type
    if (playbook.type !== "form-definition") {
        errors.push(new ValidationError("root.type", 'type must be "form-definition"'));
    }

    // meta (required)
    if (!playbook.meta) {
        errors.push(new ValidationError("meta", "meta is required"));
    } else {
        validateMeta(playbook.meta, errors);
    }

    // i18n (required)
    if (!playbook.i18n) {
        errors.push(new ValidationError("i18n", "i18n is required"));
    } else {
        validateI18nConfig(playbook.i18n, errors);
    }

    // form (required)
    if (!playbook.form) {
        errors.push(new ValidationError("form", "form is required"));
    } else {
        validateForm(playbook.form, errors);
    }

    // runtime (optional)
    if (playbook.runtime !== undefined) {
        validateRuntime(playbook.runtime, errors);
    }

    // variables (optional)
    if (playbook.variables !== undefined) {
        validateVariables(playbook.variables, errors);
    }

    // calculation (optional)
    if (playbook.calculation !== undefined) {
        validateCalculation(playbook.calculation, errors);
    }

    // schemaId (optional)
    if (playbook.schemaId !== undefined) {
        if (typeof playbook.schemaId !== "string") {
            errors.push(new ValidationError("root.schemaId", "schemaId must be a string"));
        } else {
            isSafeString(playbook.schemaId, "root.schemaId", errors, 200);
        }
    }

    // schemaHash (optional)
    if (playbook.schemaHash !== undefined) {
        if (typeof playbook.schemaHash !== "string") {
            errors.push(new ValidationError("root.schemaHash", "schemaHash must be a string"));
        } else {
            isSafeString(playbook.schemaHash, "root.schemaHash", errors, 200);
        }
    }

    // Extract declared variable IDs for cross-referencing in effect values
    const variableIds = (playbook.variables ?? []).map(v => v.id).filter(id => typeof id === "string");

    // questions (required) – must be validated before flow (for reference checking)
    let questionIds = new Set();
    if (!playbook.questions) {
        errors.push(new ValidationError("questions", "questions is required"));
    } else {
        questionIds = validateQuestions(playbook.questions, errors, variableIds);
    }

    // flow (required) – needs question IDs for reference checking
    if (!playbook.flow) {
        errors.push(new ValidationError("flow", "flow is required"));
    } else {
        validateFlow(playbook.flow, questionIds, errors);
    }

    const hasErrors = errors.some(e => e.severity === "error");
    return {
        valid: !hasErrors,
        errors
    };
}

export default validatePlaybook;
