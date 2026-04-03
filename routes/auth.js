const router = require('express').Router();

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'drake';

router.post('/auth', (req, res) => {
  const { password } = req.body;
  if (password === SITE_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Wrong password' });
  }
});

module.exports = router;
