// server.js - Updated with Security and Expiry
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');
const ip = require('ip');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 9000;
const UPLOAD_DIR = path.join(__dirname, 'shared_files');
const FILE_EXPIRY_MS = 60 * 60 * 1000; // 1 Hour

// SECURITY CONFIG
// Generate a 6-digit PIN
const generatePin = () => Math.floor(100000 + Math.random() * 900000).toString();
let PASSCODE = generatePin();
console.log('---------------------------------------------------');
console.log('🔒 SECURITY PIN:', PASSCODE);
console.log('---------------------------------------------------');

// Rate Limiting
const FAILED_ATTEMPTS = new Map();
const BLOCKED_IPS = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 5 * 60 * 1000; // 5 mins

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// --- NEW: Security Middleware with Rate Limiting ---
const logStream = fs.createWriteStream(path.join(__dirname, 'server_debug.log'), { flags: 'a' });
function debugLog(msg) {
  const time = new Date().toISOString();
  try { logStream.write(`[${time}] ${msg}\n`); } catch (e) { }
  console.log(`[DEBUG] ${msg}`);
}

const authMiddleware = (req, res, next) => {
  const clientIP = req.ip;

  // Check Blocklist
  if (BLOCKED_IPS.has(clientIP)) {
    const expireTime = BLOCKED_IPS.get(clientIP);
    if (Date.now() < expireTime) {
      // debugLog(`Blocked IP ${clientIP} rejected.`); // Commented out to reduce spam
      return res.status(403).json({ error: "Access denied: Too many failed attempts. Try again later." });
    } else {
      BLOCKED_IPS.delete(clientIP);
      FAILED_ATTEMPTS.delete(clientIP);
    }
  }

  const pinFromHeader = req.headers['x-passcode'];
  const pinFromQuery = req.query.pin; // For <a> tag downloads

  // Debug Log: Check for mismatches on ANY protected route
  if (pinFromHeader && pinFromHeader !== PASSCODE) {
    debugLog(`Auth Mismatch from ${clientIP} on ${req.path}. Received: '${pinFromHeader}' (Len: ${pinFromHeader.length}), Expected: '${PASSCODE}'`);
  } else if (!pinFromHeader && !pinFromQuery && req.path !== '/connection-info') {
    debugLog(`Auth Missing from ${clientIP} on ${req.path}`);
  }

  // Specific debug for Upload to keep confirming success there
  if (req.path === '/api/upload' && pinFromHeader === PASSCODE) {
    debugLog(`Auth Success for Upload from ${clientIP}`);
  }

  if (pinFromHeader === PASSCODE || pinFromQuery === PASSCODE) {
    // Reset failures on success
    FAILED_ATTEMPTS.delete(clientIP);
    next();
  } else {
    // Increment Failure
    const attempts = (FAILED_ATTEMPTS.get(clientIP) || 0) + 1;
    FAILED_ATTEMPTS.set(clientIP, attempts);
    debugLog(`Auth Failed for ${clientIP}. Attempt ${attempts}/${MAX_ATTEMPTS}`);

    if (attempts >= MAX_ATTEMPTS) {
      BLOCKED_IPS.set(clientIP, Date.now() + BLOCK_DURATION);
      console.warn(`[SECURITY] Blocked IP ${clientIP} for repeated failed PIN attempts.`);
    }

    res.status(401).json({ error: "Unauthorized access: Invalid PIN" });
  }
};

// --- NEW: Automatic File Deletion Logic ---
const cleanupFiles = () => {
  const now = Date.now();
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(UPLOAD_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && (now - stats.mtimeMs > FILE_EXPIRY_MS)) {
          fs.unlink(filePath, () => console.log(`Deleted expired: ${file}`));
        }
      });
    });
  });
};
setInterval(cleanupFiles, 60000); // Check every minute

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    cb(null, id + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// PROTECTED ENDPOINTS
app.post('/api/upload', authMiddleware, upload.array('files'), (req, res) => {
  const results = [];
  const files = req.files || [];

  files.forEach(f => {
    // INTEGRITY CHECK
    const clientHash = req.body['hash-' + f.originalname]; // We will send hashes in body with keys like "hash-filename.ext"
    // Note: multer handles body fields too if they come before files, but for simplicity we might verify AFTER upload or rely on a separate header if doing single.
    // However, since we are doing parallel/multiple, reading body is tricky if mixed. 
    // BETTER APPROACH for simplicity: Client sends hash in a header 'x-file-hash' if uploading one by one.
    // If doing parallel, we should use 'upload.single' in a loop or handle verification per file.

    // For this implementation, let's assume the client sends 'x-file-hash' headers corresponding to the file being uploaded.
    // Since we are upgrading to parallel single uploads in frontend, req.files will be array of 1 (or we change backend to .single).
    // Let's stick to array but process them.

    // Calculate Server Hash
    const fileBuffer = fs.readFileSync(f.path);
    const sum = crypto.createHash('sha256');
    sum.update(fileBuffer);
    const serverHash = sum.digest('hex');

    const providedHash = req.headers['x-file-hash'];

    if (providedHash && providedHash !== serverHash) {
      console.error(`[INTEGRITY FAIL] File: ${f.originalname} | Client: ${providedHash} | Server: ${serverHash}`);
      fs.unlinkSync(f.path); // Delete corrupted file
      results.push({ name: f.originalname, error: "Integrity Check Failed: Hash Mismatch" });
    } else {
      if (providedHash) console.log(`[INTEGRITY PASS] ${f.originalname}`);
      results.push({ id: f.filename, name: f.originalname, size: f.size, verified: !!providedHash });
    }
  });

  res.json({ results });
});

app.get('/api/files', authMiddleware, (req, res) => {
  const list = fs.readdirSync(UPLOAD_DIR).map(fn => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, fn));
    const original = fn.replace(/^\d+-[a-z0-9]+-/, '');
    return { id: fn, name: original, size: stat.size, mtime: stat.mtime };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json({ files: list });
});

app.get('/api/files/:id/download', authMiddleware, (req, res) => {
  const fpath = path.join(UPLOAD_DIR, req.params.id);
  if (!fs.existsSync(fpath)) return res.status(404).send('Not found');
  res.download(fpath, req.params.id.replace(/^\d+-[a-z0-9]+-/, ''));
});

app.get('/api/dir-stats', authMiddleware, (req, res) => {
  let total = 0;
  fs.readdirSync(UPLOAD_DIR).forEach(f => total += fs.statSync(path.join(UPLOAD_DIR, f)).size);
  res.json({ totalBytes: total });
});

// PUBLIC INFO
app.get('/connection-info', async (req, res) => {
  const localIP = ip.address();
  const link = `http://${localIP}:${PORT}`;
  const qrImage = await QRCode.toDataURL(link);
  res.json({ link, qrImage });
});

app.listen(PORT, () => console.log(`ShareIt Secure: http://localhost:${PORT}`));