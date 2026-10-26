import { logger } from "../../../lib/logger.js";
import mongoose from "mongoose";
import { findUserByIdentifier } from "./utils.js";
import { escapeRegex } from "../middleware/sanitize.js";

/**
 * DELETE /api/users/:id
 *
 * Path parameters:
 *   - id (string, required): MongoDB ObjectId or userid of the user to remove.
 */
export default async function deleteUser(req, res) {
  try {
    const user = await findUserByIdentifier(req.params?.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Block deletion of super_admin regardless of who is asking
    if (Array.isArray(user.roles) && user.roles.includes('super_admin')) {
      return res.status(403).json({ error: "This user cannot be deleted." });
    }

    const userEmail = user.e_mail;
    await user.deleteOne();

    // Cascading delete for BetterAuth sessions
    try {
      if (mongoose.connection && mongoose.connection.db) {
        const db = mongoose.connection.db;
        if (userEmail) {
          const baUser = await db.collection("user").findOne({ email: new RegExp(`^${escapeRegex(userEmail)}$`, 'i') });
          if (baUser) {
            await db.collection("session").deleteMany({ userId: baUser._id.toString() });
            await db.collection("account").deleteMany({ userId: baUser._id.toString() });
            await db.collection("user").deleteOne({ _id: baUser._id });
            logger.info(`[deleteUser] Purged BetterAuth records for user ${baUser._id}`);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "[deleteUser] Non-fatal error cleaning BetterAuth sessions");
    }

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, "[DELETE /api/users/:id]");
    res.status(500).json({ error: "Unable to delete user" });
  }
}
