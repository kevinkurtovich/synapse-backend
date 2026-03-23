const { Router } = require('express');
const router = Router();

// POST /api/calibration/run → CalibrateSnapshot service
router.post('/run', async (req, res) => {
  // TODO: implement CalibrateSnapshot
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/calibration/profiles/:id
router.get('/profiles/:id', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/calibration/profiles/:id/retire
router.post('/profiles/:id/retire', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
