const { Router } = require('express');
const { validateSnapshot } = require('../services/validateSnapshot');
const router = Router();

// POST /api/validations/:id/validate → ValidateSnapshot service
// :id is the restoration_profile_id
router.post('/:id/validate', async (req, res) => {
  try {
    const result = await validateSnapshot(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
