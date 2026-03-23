const { Router } = require('express');
const router = Router();

// POST /api/personas/:id/distill → DistillPersona service
router.post('/:id/distill', async (req, res) => {
  // TODO: implement DistillPersona
  res.status(501).json({ error: 'Not implemented' });
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
