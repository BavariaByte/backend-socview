import { logger } from "../../../lib/logger.js";
import { TicketModel } from "@girp/database-models";
import { findTicketByIdentifier } from "./utils.js";
import { sanitizeString, stripMongoOperators } from "../middleware/sanitize.js";
import { uploadToGridFS, deleteFromGridFS } from "../../../lib/gridfs.js";

/**
 * POST /api/tickets/:id/comments
 *
 * Path parameters:
 *   - id (string, required): Ticket MongoID or ticket_id
 *
 * Form-data (multipart/form-data):
 *   - comment_content (string, required): Content of the comment
 *   - files (binary[], optional): Bis zu 5 Dateien, max 10MB pro Datei
 *
 * SECURITY: The author is ALWAYS derived from the authenticated session.
 * Any `author` field in the body is intentionally ignored.
 */
export default async function addTicketComment(req, res) {
    try {
        if (req.body && typeof req.body === 'object') {
            stripMongoOperators(req.body);
        }

        const ticket = await findTicketByIdentifier(req.params?.id);
        if (!ticket) {
            return res.status(404).json({ error: "Ticket not found" });
        }

        const commentContent = sanitizeString(req.body?.comment_content);
        if (!commentContent) {
            return res.status(400).json({ error: "comment_content is required" });
        }

        const authorId = req.sessionUser?._id;
        if (!authorId) {
            return res.status(401).json({ error: "Authenticated session required to comment" });
        }

        // Upload files to GridFS; track fileIds for rollback on DB error
        const attachments = [];
        const uploadedFileIds = [];

        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                const fileId = await uploadToGridFS(file.buffer, file.originalname, file.mimetype);
                uploadedFileIds.push(fileId);
                attachments.push({
                    filename: fileId.toString(), // GridFS ObjectId as string — used as download key
                    originalName: file.originalname,
                    mimeType: file.mimetype,
                    size: file.size,
                    uploadedAt: new Date(),
                });
            }
        }

        const commentData = {
            comment_content: commentContent,
            author: authorId,
            submittedAt: new Date(),
        };
        if (attachments.length > 0) {
            commentData.attachments = attachments;
        }

        let update;
        try {
            update = await TicketModel.findByIdAndUpdate(
                ticket._id,
                { $push: { comments: commentData } },
                { new: true, runValidators: true, userId: req.sessionUser?._id }
            ).lean();
        } catch (dbErr) {
            for (const fid of uploadedFileIds) {
                await deleteFromGridFS(fid.toString());
            }
            throw dbErr;
        }

        const inserted = Array.isArray(update?.comments)
            ? update.comments[update.comments.length - 1]
            : null;

        if (!inserted) {
            for (const fid of uploadedFileIds) {
                await deleteFromGridFS(fid.toString());
            }
            return res.status(500).json({ error: "Unable to persist comment" });
        }

        res.status(201).json({
            _id: inserted._id?.toString(),
            comment_content: inserted.comment_content,
            author: inserted.author?.toString?.() || inserted.author,
            submittedAt: inserted.submittedAt instanceof Date
                ? inserted.submittedAt.toISOString()
                : inserted.submittedAt,
            attachments: (inserted.attachments || []).map(att => ({
                filename: att.filename,       // GridFS ObjectId string
                originalName: att.originalName,
                mimeType: att.mimeType,
                size: att.size,
                uploadedAt: att.uploadedAt instanceof Date
                    ? att.uploadedAt.toISOString()
                    : att.uploadedAt,
            }))
        });
    } catch (error) {
        logger.error({ err: error }, "[POST /api/tickets/:id/comments]");
        res.status(500).json({ error: "Unable to add comment" });
    }
}
