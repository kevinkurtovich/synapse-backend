const { Router } = require('express');
const { createSession, sendMessage, closeSession } = require('../services/sessionService');
const { authenticate } = require('../middleware/auth');
const router = Router();

// POST /api/sessions → CreateSession service
router.post('/', authenticate, async (req, res) => {
  try {
    const { restoration_profile_id, name } = req.body;
    const session = await createSession(restoration_profile_id, name, req.userId);
    res.status(201).json(session);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/sessions/:id/messages → SendMessage service
router.post('/:id/messages', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    const result = await sendMessage(req.params.id, content);
    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/sessions/:id/messages
router.get('/:id/messages', async (req, res) => {
  res.status(501).json({ error: 'Not implemented' });
});

// POST /api/sessions/:id/close → CloseSession service
router.post('/:id/close', authenticate, async (req, res) => {
  try {
    const session = await closeSession(req.params.id);
    res.status(200).json(session);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
