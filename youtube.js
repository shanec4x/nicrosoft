const router = require('express').Router();
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUTPUTS_DIR = path.join(__dirname, '../outputs');

// In-memory job store
const jobs = {};

// ── GET VIDEO INFO ──
router.post('/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  // Validate it's a YouTube URL
  if (!isYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Only YouTube URLs are supported' });
  }

  execFile('yt-dlp', [
    '--dump-json',
    '--no-playlist',
    url,
  ], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('yt-dlp info error:', stderr);
      return res.status(500).json({ error: 'Could not fetch video info. Is yt-dlp installed?' });
    }

    try {
      const info = JSON.parse(stdout);
      const formats = (info.formats || [])
        .filter(f => f.vcodec !== 'none' || f.acodec !== 'none')
        .filter(f => f.ext !== 'mhtml')
        .map(f => ({
          formatId: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : null),
          abr: f.abr ? `${Math.round(f.abr)}kbps` : null,
          filesize: f.filesize || f.filesize_approx || null,
          note: f.format_note || '',
          hasVideo: f.vcodec !== 'none',
          hasAudio: f.acodec !== 'none',
        }))
        .filter(f => f.hasVideo) // default: show video formats
        .sort((a, b) => {
          const aRes = parseInt(a.resolution) || 0;
          const bRes = parseInt(b.resolution) || 0;
          return bRes - aRes;
        })
        .slice(0, 8);

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        channel: info.channel || info.uploader,
        formats,
        videoId: info.id,
      });
    } catch (parseErr) {
      res.status(500).json({ error: 'Failed to parse video info' });
    }
  });
});

// ── START DOWNLOAD ──
router.post('/download', (req, res) => {
  const { url, format, type } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL' });
  if (!isYouTubeUrl(url)) return res.status(400).json({ error: 'Only YouTube URLs supported' });

  const jobId = 'dl_' + Date.now();
  const ext = type === 'mp3' ? 'mp3' : 'mp4';
  const outputTemplate = path.join(OUTPUTS_DIR, `yt_${jobId}.%(ext)s`);

  jobs[jobId] = { status: 'Starting...', progress: 0, done: false };

  res.json({ ok: true, jobId });

  // Build yt-dlp args
  const args = ['--no-playlist', '-o', outputTemplate];

  if (type === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    if (format) {
      // Merge best video+audio for selected format
      args.push('-f', `${format}+bestaudio/best`, '--merge-output-format', 'mp4');
    } else {
      args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
    }
  }

  args.push('--newline', url);

  const proc = spawn('yt-dlp', args);

  proc.stdout.on('data', (data) => {
    const line = data.toString();
    // Parse yt-dlp progress lines like: [download]  23.4% of  45.67MiB at  3.21MiB/s ETA 00:12
    const match = line.match(/(\d+(?:\.\d+)?)%/);
    if (match) {
      const pct = Math.round(parseFloat(match[1]));
      jobs[jobId].progress = pct;
      jobs[jobId].status = `Downloading... ${pct}%`;
    }
    if (line.includes('[Merger]') || line.includes('[ffmpeg]')) {
      jobs[jobId].status = 'Merging...';
      jobs[jobId].progress = 95;
    }
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('ERROR')) {
      jobs[jobId].error = line.trim();
    }
  });

  proc.on('close', (code) => {
    if (code === 0) {
      // Find the output file
      const files = fs.readdirSync(OUTPUTS_DIR).filter(f => f.startsWith(`yt_${jobId}`));
      const filename = files[0];
      jobs[jobId] = {
        status: '> COMPLETE',
        progress: 100,
        done: true,
        downloadUrl: filename ? `/outputs/${filename}` : null,
      };
    } else {
      jobs[jobId] = {
        ...jobs[jobId],
        status: 'Download failed',
        error: jobs[jobId].error || 'yt-dlp exited with code ' + code,
        done: true,
        progress: 0,
      };
    }
  });
});

// ── POLL PROGRESS ──
router.get('/progress/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
}

module.exports = router;
