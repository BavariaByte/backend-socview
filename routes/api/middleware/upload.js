import multer from 'multer';
import path from 'path';

// ---------------------------------------------------------------------------
// Allowed file extensions (allowlist approach)
//
// SVG is intentionally NOT allowed: SVG is XML and supports <script>,
// <foreignObject>, on*-handlers and javascript: URLs.
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp',
    '.txt', '.csv', '.log', '.json', '.xml',
    '.zip', '.7z', '.tar', '.gz',
]);

// ---------------------------------------------------------------------------
// Magic-byte signatures for binary file types
// ---------------------------------------------------------------------------
const MAGIC_BYTES = {
    '.jpg':  { offset: 0,   bytes: [0xFF, 0xD8, 0xFF] },
    '.jpeg': { offset: 0,   bytes: [0xFF, 0xD8, 0xFF] },
    '.png':  { offset: 0,   bytes: [0x89, 0x50, 0x4E, 0x47] },
    '.gif':  { offset: 0,   bytes: [0x47, 0x49, 0x46, 0x38] },
    '.pdf':  { offset: 0,   bytes: [0x25, 0x50, 0x44, 0x46] },
    '.zip':  { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.docx': { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.xlsx': { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.pptx': { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.odt':  { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.ods':  { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.odp':  { offset: 0,   bytes: [0x50, 0x4B, 0x03, 0x04] },
    '.7z':   { offset: 0,   bytes: [0x37, 0x7A, 0xBC, 0xAF] },
    '.gz':   { offset: 0,   bytes: [0x1F, 0x8B] },
    '.bmp':  { offset: 0,   bytes: [0x42, 0x4D] },
    '.webp': { offset: 0,   bytes: [0x52, 0x49, 0x46, 0x46] },
    '.doc':  { offset: 0,   bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
    '.xls':  { offset: 0,   bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
    '.ppt':  { offset: 0,   bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },
    '.tar':  { offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] },
};

const TEXT_EXTENSIONS = new Set(['.txt', '.csv', '.log', '.json', '.xml']);

function matchesMagic(buffer, signature) {
    if (buffer.length < signature.offset + signature.bytes.length) return false;
    for (let i = 0; i < signature.bytes.length; i++) {
        if (buffer[signature.offset + i] !== signature.bytes[i]) return false;
    }
    return true;
}

function looksLikeText(buffer) {
    const checkLen = Math.min(buffer.length, 8192);
    for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0x00) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Multer instance — memoryStorage (files in req.files[].buffer)
// ---------------------------------------------------------------------------
export const commentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 5,
    },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            cb(new Error(`File type "${ext}" is not allowed.`), false);
            return;
        }
        cb(null, true);
    },
});

// ---------------------------------------------------------------------------
// Post-upload magic-byte validation middleware (buffer-based, no disk I/O)
// ---------------------------------------------------------------------------
export function validateFileHeaders(req, res, next) {
    const files = req.files;
    if (!files || !Array.isArray(files) || files.length === 0) return next();

    for (const file of files) {
        const ext = path.extname(file.originalname).toLowerCase();
        const buffer = file.buffer;

        const signature = MAGIC_BYTES[ext];
        if (signature) {
            if (!matchesMagic(buffer, signature)) {
                return res.status(400).json({
                    error: `File "${file.originalname}" does not match the expected format for "${ext}".`
                });
            }
        } else if (TEXT_EXTENSIONS.has(ext)) {
            if (!looksLikeText(buffer)) {
                return res.status(400).json({
                    error: `File "${file.originalname}" appears to be binary but has a text extension ("${ext}").`
                });
            }
        }
    }

    next();
}

export default commentUpload;
