const { Router } = require('express');
const { distillPersona } = require('../services/distillPersona');
const { authenticate } = require('../middleware/auth');
const router = Router();

// POST /api/personas/:id/distill → DistillPersona service
router.post('/:id/distill', authenticate, async (req, res) => {
  try {
    const personaId = req.params.id;
    const { transcript, parent_snapshot_id } = req.body;

    const result = await distillPersona(personaId, transcript, parent_snapshot_id);

    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/personas/:id
router.get('/:id', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/personas
router.get('/', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
