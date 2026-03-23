const { Router } = require('express');
const router = Router();

// POST /api/sessions → CreateSession service
router.post('/', async (req, res) => {
  // TODO: implement CreateSession
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/sessions/:id/messages → SendMessage service
router.post('/:id/messages', async (req, res) => {
  // TODO: implement SendMessage
  res.status(501).json({ error: 'Not implemented' });
});

// GET /api/sessions/:id/messages
router.get('/:id/messages', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/sessions/:id/close → CloseSession service
router.post('/:id/close', async (req, res) => {
  // TODO: implement CloseSession
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
