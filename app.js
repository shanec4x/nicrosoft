// ── CONFIG ──
const API = ''; // same origin, empty = relative URLs

// ── PASSWORD GATE ──
function checkPass() {
  const val = document.getElementById('gate-input').value;
  fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: val })
  })
  .then(r => r.json())
  .then(d => {
    if (d.ok) {
      document.getElementById('gate').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      init();
    } else {
      document.getElementById('gate-err').textContent = 'WRONG PASSWORD';
      document.getElementById('gate-input').value = '';
      document.getElementById('gate-input').focus();
    }
  })
  .catch(() => {
    // Dev fallback — remove in production
    if (val === 'drake') {
      document.getElementById('gate').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      init();
    } else {
      document.getElementById('gate-err').textContent = 'WRONG PASSWORD';
    }
  });
}

// ── STATE ──
const EMOJIS = ['🏔','🌊','🌆','🌃','🎭','🏄','🎪','🌅','🎠','🏞','🎨','🌌','🦅','🌿','🍂','🏜','🌾','🪨'];
const CLIP_COLORS = [
  { bg: '#2a3a10', text: '#90c030' },
  { bg: '#10302a', text: '#30c090' },
  { bg: '#3a2510', text: '#c08030' },
  { bg: '#10203a', text: '#3090c0' },
  { bg: '#2a1030', text: '#9030c0' },
  { bg: '#302a10', text: '#c0a030' },
];

let state = {
  folders: [{ id: 'all', name: 'All Videos' }],
  videos: [
    { id: 'v1', name: 'forest_path.mp4', dur: 54, ei: 13, ci: 0, folder: 'all', muxId: null },
    { id: 'v2', name: 'river_flow.mp4',  dur: 87, ei: 9,  ci: 1, folder: 'all', muxId: null },
    { id: 'v3', name: 'canyon_dusk.mp4', dur: 41, ei: 0,  ci: 2, folder: 'all', muxId: null },
    { id: 'v4', name: 'tide_pool.mp4',   dur: 112,ei: 1,  ci: 3, folder: 'all', muxId: null },
    { id: 'v5', name: 'meadow_wind.mp4', dur: 33, ei: 14, ci: 5, folder: 'all', muxId: null },
  ],
  selected: [],
  activeFolder: 'all',
  audio: null,
  audioStart: 0,
  totalDur: 30,
  generated: false,
  playing: false,
  playPos: 0,
  playTimer: null,
  ytInfo: null,
  ytSelectedFormat: null,
  dlHistory: [],
};

function init() {
  renderFolders();
  renderGrid();
  renderTimeline();
}

// ── TABS ──
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-content-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'editor') renderEditor();
}

// ── LIBRARY ──
function renderFolders() {
  document.getElementById('folder-list').innerHTML = state.folders.map(f => `
    <div class="folder-item${f.id === state.activeFolder ? ' active' : ''}" onclick="setFolder('${f.id}')">
      ${f.id === 'all' ? '📁' : '📂'} ${f.name}
    </div>
  `).join('');
}

function setFolder(id) {
  state.activeFolder = id;
  const f = state.folders.find(x => x.id === id);
  document.getElementById('folder-heading').textContent = f.name.toUpperCase();
  renderFolders();
  renderGrid();
}

function renderGrid() {
  const videos = state.videos.filter(v =>
    state.activeFolder === 'all' || v.folder === state.activeFolder
  );
  const grid = document.getElementById('video-grid');
  const empty = document.getElementById('empty-msg');
  if (!videos.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = videos.map(v => {
    const sel = state.selected.includes(v.id);
    const c = CLIP_COLORS[v.ci];
    return `
      <div class="video-card${sel ? ' selected' : ''}" onclick="toggleSelect('${v.id}')">
        <div class="vid-thumb" style="background:${c.bg}">
          <span>${EMOJIS[v.ei]}</span>
          <div class="vid-check"></div>
        </div>
        <div class="vid-info">
          <div class="vid-name">${v.name}</div>
          <div class="vid-dur">${fmtDur(v.dur)}</div>
        </div>
      </div>
    `;
  }).join('');
  updateSelUI();
}

function toggleSelect(id) {
  const i = state.selected.indexOf(id);
  if (i >= 0) {
    state.selected.splice(i, 1);
  } else if (state.selected.length < 5) {
    state.selected.push(id);
  } else {
    toast('MAX 5 CLIPS');
    return;
  }
  renderGrid();
}

function clearSel() { state.selected = []; renderGrid(); }

function updateSelUI() {
  const n = state.selected.length;
  const counter = document.getElementById('sel-counter');
  const makeBtn = document.getElementById('make-btn');
  const clrBtn = document.getElementById('clr-btn');
  const selInfo = document.getElementById('sel-info');
  if (n > 0) {
    counter.textContent = `${n}/5 SELECTED`;
    counter.style.display = 'inline-block';
    makeBtn.disabled = false;
    clrBtn.style.display = 'inline-block';
    selInfo.textContent = `${n} CLIP${n > 1 ? 'S' : ''} SELECTED`;
  } else {
    counter.style.display = 'none';
    makeBtn.disabled = true;
    clrBtn.style.display = 'none';
    selInfo.textContent = '';
  }
}

function triggerUpload() { document.getElementById('upload-input').click(); }

async function handleUpload(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const id = 'v' + Date.now() + Math.random().toString(36).slice(2, 6);
    // Upload to backend / Mux
    const formData = new FormData();
    formData.append('video', file);
    let muxId = null;
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      muxId = data.assetId || null;
    } catch (err) { /* offline/dev mode, continue */ }

    state.videos.push({
      id, name: file.name, dur: 0, muxId,
      ei: Math.floor(Math.random() * EMOJIS.length),
      ci: Math.floor(Math.random() * CLIP_COLORS.length),
      folder: state.activeFolder === 'all' ? 'all' : state.activeFolder,
    });
  }
  renderGrid();
  e.target.value = '';
}

function handleDrop(e) {
  e.preventDefault();
  const fake = { target: { files: e.dataTransfer.files }, value: '' };
  handleUpload(fake);
}

// ── EDITOR ──
function renderEditor() {
  const clips = state.selected.map(id => state.videos.find(v => v.id === id)).filter(Boolean);
  const hint = document.getElementById('no-clips-hint');
  hint.style.display = clips.length ? 'none' : 'block';

  document.getElementById('ed-clip-list').innerHTML = clips.map(c => {
    const col = CLIP_COLORS[c.ci];
    return `
      <div class="ed-clip-row">
        <div class="ed-clip-thumb" style="background:${col.bg}">${EMOJIS[c.ei]}</div>
        <div class="ed-clip-name">${c.name.replace('.mp4','').replace('.mov','')}</div>
        <div class="ed-clip-dur">${fmtDur(c.dur)}</div>
      </div>
    `;
  }).join('');
  renderTimeline();
}

function onDurChange(v) {
  state.totalDur = parseInt(v);
  document.getElementById('dur-display').textContent = fmtFull(v);
  renderTimeline();
}

function renderTimeline() {
  const clips = state.selected.map(id => state.videos.find(v => v.id === id)).filter(Boolean);
  const total = state.totalDur;
  const PX = 560;
  const pps = PX / total;
  const perClip = clips.length ? Math.floor(total / clips.length) : total;
  const step = total <= 30 ? 5 : total <= 120 ? 15 : total <= 300 ? 30 : 60;

  let html = '';

  // Ruler row
  html += `<div class="tl-row"><div class="tl-label">SEC</div><div class="tl-body" style="width:${PX}px"><div class="tl-ruler" style="width:${PX}px">`;
  for (let t = 0; t <= total; t += step) {
    html += `<div class="tl-tick" style="left:${Math.round(t * pps)}px">${t}</div>`;
  }
  html += '</div></div></div>';

  // Clips row
  html += `<div class="tl-row"><div class="tl-label">CLIP</div><div class="tl-body" style="position:relative;width:${PX}px">`;
  let off = 0;
  clips.forEach((c) => {
    const w = Math.max(24, Math.round(perClip * pps));
    const left = Math.round(off * pps);
    const aw = Math.min(w, PX - left);
    const col = CLIP_COLORS[c.ci];
    html += `<div class="tl-clip" style="left:${left}px;width:${aw}px;background:${col.bg};color:${col.text}">${EMOJIS[c.ei]} ${c.name.split('.')[0].slice(0, 12)}</div>`;
    off += perClip;
  });
  const ph = Math.round((state.playPos / Math.max(1, total)) * PX);
  html += `<div class="tl-playhead" id="tl-ph" style="left:${ph}px"></div>`;
  html += '</div></div>';

  // Audio row
  html += `<div class="tl-row"><div class="tl-label">AUDIO</div><div class="tl-body" style="position:relative;width:${PX}px">`;
  if (state.audio) {
    html += `<div class="tl-audio" style="left:0;width:${Math.round(total * pps)}px">♪ ${state.audio}</div>`;
  } else {
    html += `<div class="tl-no-audio">NO AUDIO</div>`;
  }
  html += '</div></div>';

  document.getElementById('timeline').innerHTML = html;
}

function autoLayout() { renderTimeline(); }

// ── AUDIO ──
function triggerAudioUpload() { document.getElementById('audio-input').click(); }

function onAudioFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  state.audio = f.name;
  document.getElementById('audio-ui').innerHTML = `
    <div class="audio-loaded-row">
      ♪ <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px">${f.name}</span>
      <button class="btn-3d-sm" onclick="removeAudio()" style="font-size:9px;padding:3px 7px">✕</button>
    </div>
  `;
  document.getElementById('audio-trim-ui').style.display = 'block';
  renderTimeline();
}

function removeAudio() {
  state.audio = null;
  document.getElementById('audio-ui').innerHTML = `<div class="upload-audio-btn" onclick="triggerAudioUpload()">+ UPLOAD AUDIO FILE</div>`;
  document.getElementById('audio-trim-ui').style.display = 'none';
  renderTimeline();
}

function onAudioStart(v) {
  state.audioStart = parseInt(v);
  document.getElementById('astart-display').textContent = fmtFull(v);
}

// ── GENERATE ──
async function generateClip() {
  const clips = state.selected.map(id => state.videos.find(v => v.id === id)).filter(Boolean);
  if (!clips.length) { toast('SELECT CLIPS FIRST'); return; }

  const btn = document.getElementById('gen-btn');
  const status = document.getElementById('gen-status');
  btn.disabled = true;
  btn.textContent = '>> PROCESSING...';
  status.textContent = 'Sending to server...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clips: clips.map(c => ({ id: c.id, muxId: c.muxId, name: c.name })),
        totalDur: state.totalDur,
        audioStart: state.audioStart,
        hasAudio: !!state.audio,
      })
    });
    const data = await res.json();
    status.textContent = data.message || 'Done';
    state.generated = true;
  } catch (err) {
    // Dev mode simulation
    status.textContent = 'Assembling...';
    await sleep(1800);
    state.generated = true;
    status.textContent = '> READY';
  }

  btn.disabled = false;
  btn.textContent = '▶▶ REGENERATE';
  document.getElementById('crt-idle').style.display = 'none';
  document.getElementById('crt-playing').style.display = 'flex';
  document.getElementById('crt-playing').style.flexDirection = 'column';
  document.getElementById('crt-playing').style.alignItems = 'center';
  updateTimecode();
  renderTimeline();
}

// ── PLAYBACK ──
function togglePlay() {
  if (!state.generated) { toast('GENERATE FIRST'); return; }
  state.playing = !state.playing;
  const ico = document.getElementById('play-btn');
  if (state.playing) {
    ico.textContent = '⏸';
    runPlayback();
  } else {
    ico.textContent = '▶';
    clearInterval(state.playTimer);
  }
}

function stopPlay() {
  state.playing = false;
  state.playPos = 0;
  document.getElementById('play-btn').textContent = '▶';
  clearInterval(state.playTimer);
  updateTimecode();
  updatePlayhead();
}

function runPlayback() {
  clearInterval(state.playTimer);
  const clips = state.selected.map(id => state.videos.find(v => v.id === id)).filter(Boolean);
  state.playTimer = setInterval(() => {
    state.playPos += 0.1;
    if (state.playPos >= state.totalDur) { state.playPos = 0; }
    updateTimecode();
    updatePlayhead();
    if (clips.length) {
      const idx = Math.min(Math.floor((state.playPos / state.totalDur) * clips.length), clips.length - 1);
      const c = clips[idx];
      document.getElementById('crt-emoji').textContent = EMOJIS[c.ei];
      document.getElementById('crt-clipname').textContent = c.name.replace('.mp4','').replace('.mov','').toUpperCase();
      document.getElementById('crt-bar-fill').style.width = ((state.playPos / state.totalDur) * 100) + '%';
    }
  }, 100);
}

function updateTimecode() {
  document.getElementById('timecode').textContent = `${fmtFull(state.playPos)} / ${fmtFull(state.totalDur)}`;
  const pct = (state.playPos / Math.max(1, state.totalDur)) * 100;
  document.getElementById('scrub-fill').style.width = pct + '%';
  document.getElementById('scrub-head').style.left = pct + '%';
}

function updatePlayhead() {
  const ph = document.getElementById('tl-ph');
  if (!ph) return;
  ph.style.left = Math.round((state.playPos / state.totalDur) * 560) + 'px';
}

function seekTo(e) {
  if (!state.generated) return;
  const bar = document.getElementById('scrub-bar');
  const rect = bar.getBoundingClientRect();
  state.playPos = Math.max(0, Math.min(state.totalDur, ((e.clientX - rect.left) / rect.width) * state.totalDur));
  updateTimecode();
  updatePlayhead();
}

async function doExport() {
  if (!state.generated) { toast('GENERATE FIRST'); return; }
  try {
    const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; }
    else { toast('EXPORT READY'); }
  } catch {
    toast('NEEDS BACKEND TO EXPORT');
  }
}

// ── YOUTUBE DOWNLOADER ──
async function fetchYtInfo() {
  const url = document.getElementById('yt-url').value.trim();
  if (!url) { toast('PASTE A URL FIRST'); return; }

  document.getElementById('yt-status').textContent = '> FETCHING INFO...';
  document.getElementById('yt-info').style.display = 'none';

  try {
    const res = await fetch('/api/yt/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (data.error) { document.getElementById('yt-status').textContent = '> ERROR: ' + data.error; return; }
    state.ytInfo = data;
    renderYtInfo(data);
    document.getElementById('yt-status').textContent = '';
  } catch (err) {
    document.getElementById('yt-status').textContent = '> SERVER ERROR — IS THE BACKEND RUNNING?';
  }
}

function renderYtInfo(info) {
  document.getElementById('yt-thumb').src = info.thumbnail || '';
  document.getElementById('yt-title').textContent = info.title || 'Unknown title';
  document.getElementById('yt-duration').textContent = 'DURATION: ' + (info.duration ? fmtFull(info.duration) : 'N/A');
  document.getElementById('yt-channel').textContent = 'CHANNEL: ' + (info.channel || 'Unknown');

  const formats = info.formats || [];
  document.getElementById('format-grid').innerHTML = formats.slice(0, 8).map((f, i) => `
    <div class="format-btn${i === 0 ? ' active' : ''}" onclick="selectFormat(this, '${f.formatId}', '${f.ext}', '${f.resolution || 'audio'}')">
      ${f.resolution || f.abr || 'audio'}<br>
      <span style="font-size:8px;opacity:.7">${f.ext} ${f.filesize ? '~' + fmtSize(f.filesize) : ''}</span>
    </div>
  `).join('');

  if (formats.length) {
    state.ytSelectedFormat = formats[0].formatId;
  }

  document.getElementById('yt-info').style.display = 'block';
}

function selectFormat(el, formatId, ext, resolution) {
  document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  state.ytSelectedFormat = formatId;
}

async function startDownload() {
  const url = document.getElementById('yt-url').value.trim();
  const dlType = document.querySelector('input[name="dl-type"]:checked').value;
  if (!url) { toast('NO URL'); return; }

  const btn = document.getElementById('dl-btn');
  btn.disabled = true;
  btn.textContent = '>> DOWNLOADING...';
  document.getElementById('yt-status').textContent = '> STARTING DOWNLOAD...';
  document.getElementById('yt-progress-wrap').style.display = 'flex';
  document.getElementById('yt-progress-bar').style.width = '5%';
  document.getElementById('yt-progress-label').textContent = '5%';

  // Poll for progress
  let pollInterval;
  let jobId;

  try {
    const res = await fetch('/api/yt/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        format: state.ytSelectedFormat,
        type: dlType,
      })
    });
    const data = await res.json();
    if (data.error) {
      document.getElementById('yt-status').textContent = '> ERROR: ' + data.error;
      btn.disabled = false; btn.textContent = '▼ DOWNLOAD'; return;
    }

    jobId = data.jobId;

    // Poll progress
    pollInterval = setInterval(async () => {
      try {
        const pr = await fetch('/api/yt/progress/' + jobId);
        const pd = await pr.json();
        const pct = pd.progress || 0;
        document.getElementById('yt-progress-bar').style.width = pct + '%';
        document.getElementById('yt-progress-label').textContent = pct + '%';
        document.getElementById('yt-status').textContent = '> ' + (pd.status || 'Downloading...');

        if (pd.done) {
          clearInterval(pollInterval);
          btn.disabled = false; btn.textContent = '▼ DOWNLOAD';
          document.getElementById('yt-status').textContent = '> COMPLETE';
          // Trigger file download
          if (pd.downloadUrl) { window.location.href = pd.downloadUrl; }
          addToHistory(state.ytInfo, dlType);
        }
        if (pd.error) {
          clearInterval(pollInterval);
          btn.disabled = false; btn.textContent = '▼ DOWNLOAD';
          document.getElementById('yt-status').textContent = '> ERROR: ' + pd.error;
        }
      } catch { clearInterval(pollInterval); }
    }, 800);

  } catch (err) {
    clearInterval(pollInterval);
    document.getElementById('yt-status').textContent = '> SERVER ERROR';
    btn.disabled = false; btn.textContent = '▼ DOWNLOAD';
  }
}

function addToHistory(info, type) {
  if (!info) return;
  const item = { title: info.title || 'Unknown', type: type.toUpperCase(), time: new Date().toLocaleTimeString() };
  state.dlHistory.unshift(item);
  const hist = document.getElementById('yt-history');
  hist.innerHTML = state.dlHistory.map(h => `
    <div class="yt-history-item">
      <div class="yth-title">${h.title}</div>
      <div class="yth-meta"><span>${h.type}</span><span>${h.time}</span></div>
    </div>
  `).join('');
}

// ── FOLDER MODAL ──
function showNewFolder() {
  document.getElementById('modal').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-inp').focus(), 50);
}
function hideModal() { document.getElementById('modal').style.display = 'none'; }
function modalConfirm() {
  const name = document.getElementById('modal-inp').value.trim();
  if (!name) return;
  const id = 'f' + Date.now();
  state.folders.push({ id, name });
  renderFolders();
  hideModal();
  document.getElementById('modal-inp').value = '';
}

// ── UTILS ──
function fmtDur(s) {
  if (!s) return '0s';
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
}
function fmtFull(s) {
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.opacity = '0', 2500);
}
