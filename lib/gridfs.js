import mongoose from 'mongoose';

let bucket = null;

export function getGridFSBucket() {
    if (!bucket) {
        bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
            bucketName: 'commentFiles',
        });
    }
    return bucket;
}

export async function uploadToGridFS(buffer, originalName, mimeType) {
    const b = getGridFSBucket();
    const uploadStream = b.openUploadStream(originalName, { contentType: mimeType });

    return new Promise((resolve, reject) => {
        uploadStream.on('error', reject);
        uploadStream.on('finish', () => resolve(uploadStream.id));
        uploadStream.end(buffer);
    });
}

export async function deleteFromGridFS(fileId) {
    const b = getGridFSBucket();
    try {
        await b.delete(new mongoose.Types.ObjectId(fileId));
    } catch {
        // ignore if already gone
    }
}
