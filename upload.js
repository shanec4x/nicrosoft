const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Mux = require('@mux/mux-node');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2GB limit

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

router.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  try {
    // Create a Mux upload URL, then upload the file
    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
        mp4_support: 'standard',
      },
      cors_origin: '*',
    });

    // Stream local file to Mux upload URL
    const fileStream = fs.createReadStream(req.file.path);
    const fileStats = fs.statSync(req.file.path);

    const fetch = require('node-fetch');
    const uploadRes = await fetch(upload.url, {
      method: 'PUT',
      body: fileStream,
      headers: {
        'Content-Type': req.file.mimetype || 'video/mp4',
        'Content-Length': fileStats.size,
      },
    });

    if (!uploadRes.ok) throw new Error('Mux upload failed: ' + uploadRes.status);

    // Clean up local file after upload
    fs.unlink(req.file.path, () => {});

    res.json({
      ok: true,
      uploadId: upload.id,
      assetId: upload.asset_id || null,
      message: 'Uploaded to Mux. Asset will be ready in ~1 min.',
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    // Fallback: keep file locally if Mux fails
    res.json({
      ok: true,
      assetId: null,
      localPath: req.file.filename,
      message: 'Saved locally (Mux unavailable)',
    });
  }
});

// Get asset status from Mux
router.get('/upload/status/:assetId', async (req, res) => {
  try {
    const asset = await mux.video.assets.retrieve(req.params.assetId);
    res.json({ status: asset.status, playbackId: asset.playback_ids?.[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
