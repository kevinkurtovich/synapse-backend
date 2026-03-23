const { Router } = require('express');
const router = Router();

// POST /api/drift/check → RunDriftCheck service
router.post('/check', async (req, res) => {
  // TODO: implement RunDriftCheck
  res.status(501).json({ error: 'Not implemented' });
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
  // TODO: implement AcknowledgeAlert
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
