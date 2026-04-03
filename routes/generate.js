const router = require('express').Router();
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const Mux = require('@mux/mux-node');
const fetch = require('node-fetch');

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

const OUTPUTS_DIR = path.join(__dirname, '../outputs');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// In-memory job store (use Redis in production for multi-instance)
const jobs = {};

router.post('/generate', async (req, res) => {
  const { clips, totalDur, audioStart, hasAudio } = req.body;
  if (!clips || !clips.length) return res.status(400).json({ error: 'No clips provided' });

  const jobId = 'job_' + Date.now();
  jobs[jobId] = { status: 'starting', progress: 0, done: false };

  res.json({ ok: true, jobId, message: 'Generation started' });

  // Run async
  processClips(jobId, clips, totalDur, audioStart, hasAudio).catch(err => {
    jobs[jobId] = { ...jobs[jobId], status: 'Error: ' + err.message, error: err.message, done: true };
  });
});

router.get('/generate/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function processClips(jobId, clips, totalDur, audioStart, hasAudio) {
  jobs[jobId] = { status: 'Fetching source clips...', progress: 10, done: false };

  const perClipDur = Math.floor(totalDur / clips.length);
  const inputFiles = [];

  // Download/locate each clip
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const outPath = path.join(UPLOADS_DIR, `clip_${jobId}_${i}.mp4`);

    if (clip.muxId) {
      // Get Mux MP4 download URL
      const asset = await mux.video.assets.retrieve(clip.muxId);
      const mp4 = asset.static_renditions?.files?.find(f => f.ext === 'mp4' && f.name === 'high.mp4')
        || asset.static_renditions?.files?.[0];
      if (mp4) {
        const dlUrl = `https://stream.mux.com/${asset.playback_ids[0].id}/${mp4.name}`;
        await downloadFile(dlUrl, outPath);
      }
    } else if (clip.localPath) {
      inputFiles.push(path.join(UPLOADS_DIR, clip.localPath));
      continue;
    }
    inputFiles.push(outPath);
    jobs[jobId].progress = 10 + Math.round((i / clips.length) * 30);
    jobs[jobId].status = `Fetched clip ${i + 1}/${clips.length}`;
  }

  jobs[jobId] = { status: 'Assembling clips with FFmpeg...', progress: 45, done: false };

  // Build FFmpeg concat list
  const concatList = path.join(OUTPUTS_DIR, `concat_${jobId}.txt`);
  const listContent = inputFiles.map(f => `file '${f}'\nduration ${perClipDur}`).join('\n');
  fs.writeFileSync(concatList, listContent);

  const outputFile = path.join(OUTPUTS_DIR, `output_${jobId}.mp4`);

  await new Promise((resolve, reject) => {
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatList,
      '-t', String(totalDur),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-c:a', 'aac',
      '-y',
      outputFile,
    ];
    execFile('ffmpeg', args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });

  jobs[jobId] = { status: 'Uploading result to Mux...', progress: 80, done: false };

  // Upload finished video to Mux
  let muxPlaybackId = null;
  try {
    const upload = await mux.video.uploads.create({
      new_asset_settings: { playback_policy: ['public'], mp4_support: 'standard' },
      cors_origin: '*',
    });
    const fileStream = fs.createReadStream(outputFile);
    const fileSize = fs.statSync(outputFile).size;
    await fetch(upload.url, {
      method: 'PUT',
      body: fileStream,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': fileSize },
    });
    muxPlaybackId = upload.id;
  } catch (e) {
    console.error('Mux re-upload failed:', e.message);
  }

  // Clean up temp files
  fs.unlink(concatList, () => {});
  inputFiles.forEach(f => f.includes(`clip_${jobId}`) && fs.unlink(f, () => {}));

  jobs[jobId] = {
    status: '> COMPLETE',
    progress: 100,
    done: true,
    downloadUrl: `/outputs/output_${jobId}.mp4`,
    muxPlaybackId,
  };
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download: ' + url);
  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}

router.post('/export', (req, res) => {
  // Return latest output file
  const files = fs.readdirSync(OUTPUTS_DIR)
    .filter(f => f.startsWith('output_') && f.endsWith('.mp4'))
    .sort().reverse();
  if (files.length) {
    res.json({ ok: true, url: '/outputs/' + files[0] });
  } else {
    res.json({ ok: false, message: 'No output yet' });
  }
});

module.exports = router;
