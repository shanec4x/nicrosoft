require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure output dirs exist
['uploads', 'outputs'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Routes
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/upload'));
app.use('/api', require('./routes/generate'));
app.use('/api/yt', require('./routes/youtube'));

// Serve outputs for download
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

// Catch-all → frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
