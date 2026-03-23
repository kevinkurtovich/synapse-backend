const { Router } = require('express');
const { calibrateSnapshot } = require('../services/calibrateSnapshot');
const router = Router();

// GET /api/snapshots/:id
router.get('/:id', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/snapshots/:id/export → ExportSnapshot service
router.get('/:id/export', async (req, res) => {
  // TODO: implement ExportSnapshot
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/snapshots/import → ImportSnapshot service
router.post('/import', async (req, res) => {
  // TODO: implement ImportSnapshot
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/snapshots/:id/calibrate → CalibrateSnapshot service
router.post('/:id/calibrate', async (req, res) => {
  try {
    const { provider, model_name } = req.body;
    const result = await calibrateSnapshot(req.params.id, provider, model_name);
    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
