import { logger } from "../../../lib/logger.js";
import crypto from "crypto";
import { ApiToken } from "@girp/database-models";
import { SCOPES } from "../../../lib/permissions.js";

/**
 * Helper: generate a token
 * Format: soc_{randomHex}
 */
const generateToken = () => {
    const random = crypto.randomBytes(32).toString("hex");
    return `soc_${random}`;
};

/**
 * Helper: hash a token
 */
const hashToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * GET /api/admin/tokens
 * Lists all tokens (without the secret).
 */
export const listTokens = async (req, res) => {
    try {
        const tokens = await ApiToken.find()
            .sort({ createdAt: -1 })
            .select("-tokenHash")
            .populate("createdBy", "username e_mail");

        res.json(tokens);
    } catch (error) {
        logger.error({ err: error }, "[GET /api/admin/tokens] Error");
        res.status(500).json({ error: "Failed to load tokens" });
    }
};

/**
 * POST /api/admin/tokens
 * Creates a new token and returns the secret exactly once.
 */
export const createToken = async (req, res) => {
    try {
        const { name, scopes } = req.body;

        if (!name) {
            return res.status(400).json({ error: "Name is required" });
        }

        const validScopes = Object.values(SCOPES);
        const requestedScopes = Array.isArray(scopes) ? scopes : [];

        const invalidScopes = requestedScopes.filter(s => !validScopes.includes(s));
        if (invalidScopes.length > 0) {
            return res.status(400).json({ error: `Unknown scopes: ${invalidScopes.join(', ')}` });
        }

        const rawToken = generateToken();
        const hashed = hashToken(rawToken);
        const prefix = rawToken.substring(0, 8); // e.g. soc_a1b2

        const newToken = await ApiToken.create({
            name,
            tokenHash: hashed,
            prefix: prefix, // Enables a fast DB lookup before the hash is checked (optional)
            scopes: requestedScopes,
            createdBy: req.sessionUser?._id
        });

        // The plaintext token is returned ONLY here
        res.status(201).json({
            token: rawToken,
            meta: {
                id: newToken._id,
                name: newToken.name,
                scopes: newToken.scopes,
                prefix: newToken.prefix
            }
        });

    } catch (error) {
        logger.error({ err: error }, "[POST /api/admin/tokens] Error");
        res.status(500).json({ error: "Failed to create token" });
    }
};

/**
 * PATCH /api/admin/tokens/:id
 * Updates status or scopes.
 */
export const updateToken = async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive, scopes } = req.body;

        const updateData = {};
        if (typeof isActive === "boolean") updateData.isActive = isActive;
        if (Array.isArray(scopes)) {
            const validScopes = Object.values(SCOPES);
            const invalidScopes = scopes.filter(s => !validScopes.includes(s));
            if (invalidScopes.length > 0) {
                return res.status(400).json({ error: `Unknown scopes: ${invalidScopes.join(', ')}` });
            }
            updateData.scopes = scopes;
        }

        const updated = await ApiToken.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true } // Return updated doc
        ).select("-tokenHash");

        if (!updated) {
            return res.status(404).json({ error: "Token not found" });
        }

        res.json(updated);
    } catch (error) {
        logger.error({ err: error }, "[PATCH /api/admin/tokens/:id] Error");
        res.status(500).json({ error: "Failed to update token" });
    }
};

/**
 * DELETE /api/admin/tokens/:id
 * Deletes a token irrevocably.
 */
export const deleteToken = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await ApiToken.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ error: "Token not found" });
        }

        res.json({ success: true, id });
    } catch (error) {
        logger.error({ err: error }, "[DELETE /api/admin/tokens/:id] Error");
        res.status(500).json({ error: "Failed to delete token" });
    }
};
