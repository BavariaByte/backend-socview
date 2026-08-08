import mongoose from 'mongoose';
import { getGridFSBucket } from '../../../lib/gridfs.js';
import { logger } from '../../../lib/logger.js';

/**
 * GET /api/files/comments/:fileId
 *
 * Streams a comment attachment from GridFS.
 * Protected by requireAuthEither + ensureAuthenticatedUser (router level)
 * plus requireScope(tickets:read) on the route itself.
 */
export default async function downloadCommentFile(req, res) {
    const { fileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID' });
    }

    try {
        const bucket = getGridFSBucket();
        const objectId = new mongoose.Types.ObjectId(fileId);

        const files = await bucket.find({ _id: objectId }).toArray();
        if (!files.length) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = files[0];
        const safeName = encodeURIComponent(file.filename);

        res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
        res.setHeader('Content-Length', file.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');

        bucket.openDownloadStream(objectId).pipe(res);
    } catch (err) {
        logger.error({ err }, '[GET /api/files/comments/:fileId]');
        res.status(500).json({ error: 'Unable to download file' });
    }
}
