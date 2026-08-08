import mongoose from 'mongoose';

/**
 * Maximum allowed length for user-supplied text fields (comments, subjects, etc.).
 */
const MAX_STRING_LENGTH = 10_000;

/**
 * Sanitize a user-supplied string value.
 *
 * 1. Coerce to string
 * 2. Remove null-bytes (\0)
 * 3. Strip all HTML tags (prevents stored XSS)
 * 4. Trim whitespace
 * 5. Enforce max length
 *
 * @param {unknown} input - Raw input value
 * @param {number}  [maxLen=MAX_STRING_LENGTH] - Maximum allowed length
 * @returns {string} Sanitized string
 */
export function sanitizeString(input, maxLen = MAX_STRING_LENGTH) {
    if (input === null || input === undefined) return '';
    let str = typeof input === 'string' ? input : String(input);

    // Remove null-bytes
    str = str.replace(/\0/g, '');

    // Strip HTML tags (covers <script>, <img onerror=...>, <iframe>, etc.)
    str = str.replace(/<[^>]*>/g, '');

    // Trim
    str = str.trim();

    // Enforce max length
    if (str.length > maxLen) {
        str = str.slice(0, maxLen);
    }

    return str;
}

/**
 * Recursively strip keys that start with "$" from an object.
 * This prevents NoSQL injection operators like $gt, $ne, $or, $regex, etc.
 *
 * Handles nested objects and arrays.
 *
 * @param {unknown} obj - The object to clean
 * @returns {unknown} Cleaned object (same reference mutated)
 */
export function stripMongoOperators(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = stripMongoOperators(obj[i]);
        }
        return obj;
    }

    for (const key of Object.keys(obj)) {
        if (key.startsWith('$')) {
            delete obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            stripMongoOperators(obj[key]);
        }
    }

    return obj;
}

/**
 * Validate that a value is a valid MongoDB ObjectId hex string.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidObjectId(value) {
    if (typeof value !== 'string') return false;
    return mongoose.Types.ObjectId.isValid(value) && /^[a-fA-F0-9]{24}$/.test(value);
}

/**
 * Escape regex meta-characters in user-supplied strings before they are
 * embedded into a `new RegExp(...)`. Prevents Regex-Injection (matching
 * unintended documents) and Catastrophic-Backtracking ReDoS.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeRegex(value) {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'string' ? value : String(value);
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape HTML special characters so a value can be safely interpolated
 * into HTML markup (e.g. email templates) without enabling injection.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'string' ? value : String(value);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Express middleware that strips MongoDB operators from req.body.
 * Should be applied before any route handler that uses req.body for DB queries.
 */
export function sanitizeBody(req, _res, next) {
    if (req.body && typeof req.body === 'object') {
        stripMongoOperators(req.body);
    }
    next();
}
