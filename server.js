// server.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cors = require('cors');
const ip = require('ip');
const QRCode = require('qrcode');


const app = express();
const PORT = process.env.PORT || 9000;
const UPLOAD_DIR = path.join(__dirname, 'shared_files');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// multer disk storage with unique prefix to preserve original names
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2,8);
    cb(null, id + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// POST /api/upload  (multipart form, field name 'files')
app.post('/api/upload', upload.array('files'), (req, res) => {
  const uploaded = (req.files || []).map(f => ({ id: f.filename, name: f.originalname, size: f.size }));
  res.json({ uploaded });
});

// GET /api/files  -> list available files
app.get('/api/files', (req, res) => {
  const list = fs.readdirSync(UPLOAD_DIR).map(fn => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, fn));
    const original = fn.replace(/^\d+-[a-z0-9]+-/, '');
    return { id: fn, name: original, size: stat.size, mtime: stat.mtime, ctime: stat.ctime, atime: stat.atime};
  }).sort((a,b)=> b.mtime - a.mtime);
  res.json({ files: list });
});

// GET /api/files/:id/download -> download file
app.get('/api/files/:id/download', (req, res) => {
  const id = req.params.id;
  const fpath = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(fpath)) return res.status(404).send('Not found');
  const original = id.replace(/^\d+-[a-z0-9]+-/, '');
  res.download(fpath, original);
});

// GET /api/dir-stats -> returns total bytes and file count (used to estimate download speed)
app.get('/api/dir-stats', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR);
  let total = 0;
  files.forEach(f => total += fs.statSync(path.join(UPLOAD_DIR, f)).size);
  res.json({ totalBytes: total, fileCount: files.length });
});

// health/info
app.get('/info', (req, res) => {
  res.json({ host: os.hostname(), port: PORT });
});


// GET /connection-info -> returns local IP link and QR code
app.get('/connection-info', async (req, res) => {
  const localIP = ip.address();
  const link = `http://${localIP}:${PORT}`;

  try {
    const qrImage = await QRCode.toDataURL(link);
    res.json({ link, qrImage });
  } catch (err) {
    console.error('QR code generation failed:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});


// start
app.listen(PORT, () => console.log(`ShareIt server running: http://localhost:${PORT}`));
