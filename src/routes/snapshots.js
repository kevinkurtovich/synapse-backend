const { Router } = require('express');
const { calibrateSnapshot } = require('../services/calibrateSnapshot');
const { authenticate } = require('../middleware/auth');
const { exportSnapshot, importSnapshot, createSnapshotDirect } = require('../services/snapshotService');
const supabase = require('../supabase');
const router = Router();

// POST /api/snapshots — createSnapshotDirect (FEAT-0007)
// Protected: requires valid Supabase JWT in Authorization header.
router.post('/', authenticate, async (req, res) => {
  try {
    const { companion_name, memory_context } = req.body;

    if (!companion_name || !companion_name.trim()) {
      return res.status(400).json({ error: 'companion_name is required' });
    }
    if (!memory_context || !memory_context.trim()) {
      return res.status(400).json({ error: 'memory_context is required' });
    }

    const result = await createSnapshotDirect(
      companion_name.trim(),
      memory_context.trim(),
      req.userId
    );

    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/snapshots/:id
router.get('/:id', async (req, res) => {
  try {
    const { data: snapshot, error } = await supabase
      .from('snapshot')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    const { data: persona } = await supabase
      .from('persona')
      .select('name')
      .eq('id', snapshot.persona_id)
      .single();

    res.status(200).json({
      ...snapshot,
      persona_name: persona ? persona.name : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/snapshots/:id/profiles
router.get('/:id/profiles', async (req, res) => {
  try {
    const { data: profiles, error } = await supabase
      .from('restoration_profile')
      .select('id, provider, model_name, status, score, created_at')
      .eq('snapshot_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json(profiles || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/snapshots/:id/export → ExportSnapshot service
router.get('/:id/export', async (req, res) => {
  try {
    const bundle = await exportSnapshot(req.params.id);
    res.status(200).json(bundle);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/snapshots/import → ImportSnapshot service
router.post('/import', async (req, res) => {
  try {
    const result = await importSnapshot(req.body);
    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
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
