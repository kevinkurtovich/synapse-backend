const { Router } = require('express');
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

module.exports = router;
