const { Router } = require('express');
const { runDriftCheck } = require('../services/runDriftCheck');
const { acknowledgeAlert } = require('../services/acknowledgeAlert');
const router = Router();

// POST /api/drift/check → RunDriftCheck service
router.post('/check', async (req, res) => {
  try {
    const { drift_monitor_id } = req.body;
    const result = await runDriftCheck(drift_monitor_id);
    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/drift/monitors
router.get('/monitors', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/drift/reports/:id
router.get('/reports/:id', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/drift/alerts
router.get('/alerts', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/drift/alerts/:id/acknowledge → AcknowledgeAlert service
router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const alert = await acknowledgeAlert(req.params.id);
    res.status(200).json(alert);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
