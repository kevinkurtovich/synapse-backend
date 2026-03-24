const { Router } = require('express');
const { validateSnapshot } = require('../services/validateSnapshot');
const supabase = require('../supabase');
const router = Router();

// GET /api/validations/runs?restoration_profile_id=:id&limit=1
router.get('/runs', async (req, res) => {
  try {
    const { restoration_profile_id, limit } = req.query;
    if (!restoration_profile_id) {
      return res.status(400).json({ error: 'restoration_profile_id is required' });
    }

    const queryLimit = parseInt(limit, 10) || 1;

    const { data: runs, error } = await supabase
      .from('validation_run')
      .select('*')
      .eq('restoration_profile_id', restoration_profile_id)
      .order('created_at', { ascending: false })
      .limit(queryLimit);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!runs || runs.length === 0) {
      return res.status(200).json({ run: null });
    }

    const run = runs[0];

    const { data: probeResults, error: probeError } = await supabase
      .from('validation_probe_result')
      .select('*')
      .eq('validation_run_id', run.id)
      .order('created_at', { ascending: true });

    if (probeError) {
      return res.status(500).json({ error: probeError.message });
    }

    res.status(200).json({ run: { ...run, probe_results: probeResults || [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
