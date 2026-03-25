const { Router } = require('express');
const { distillPersona } = require('../services/distillPersona');
const { authenticate } = require('../middleware/auth');
const supabase = require('../supabase');
const router = Router();

// POST /api/personas — create a new Persona
router.post('/', authenticate, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Slug is not used for lookup but has a unique constraint — generate one to avoid collision
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).slice(2, 6);

    const { data: persona, error } = await supabase
      .from('persona')
      .insert({ name: name.trim(), slug, owner_user_id: req.userId })
      .select('id, name, owner_user_id, created_at')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(persona);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personas — list all Personas for authenticated user with enrichment
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: personas, error } = await supabase
      .from('persona')
      .select('id, name, created_at')
      .eq('owner_user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const enriched = await Promise.all(
      (personas || []).map(async (p) => {
        let latest_score = null;
        let monitor_status = null;
        let last_check_at = null;
        let model_name = null;

        try {
          // Get latest snapshot for this persona
          const { data: latestSnap } = await supabase
            .from('snapshot')
            .select('id')
            .eq('persona_id', p.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (latestSnap) {
            // Get drift monitor for latest snapshot
            const { data: monitor } = await supabase
              .from('drift_monitor')
              .select('latest_score, status, last_check_at, restoration_profile_id')
              .eq('snapshot_id', latestSnap.id)
              .limit(1)
              .single();

            if (monitor) {
              latest_score = monitor.latest_score;
              monitor_status = monitor.status;
              last_check_at = monitor.last_check_at;

              if (monitor.restoration_profile_id) {
                const { data: profile } = await supabase
                  .from('restoration_profile')
                  .select('model_name')
                  .eq('id', monitor.restoration_profile_id)
                  .single();

                if (profile) {
                  model_name = profile.model_name;
                }
              }
            }
          }
        } catch {
          // Enrichment failure degrades gracefully — fields stay null
        }

        return {
          id: p.id,
          name: p.name,
          created_at: p.created_at,
          latest_score,
          monitor_status,
          last_check_at,
          model_name,
        };
      })
    );

    res.status(200).json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/personas/:id — composite persona detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { data: persona, error: personaError } = await supabase
      .from('persona')
      .select('id, name, owner_user_id, created_at')
      .eq('id', req.params.id)
      .single();

    if (personaError || !persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    if (persona.owner_user_id !== req.userId) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    // Latest snapshot
    let snapshot = null;
    const { data: snapData } = await supabase
      .from('snapshot')
      .select('id, created_at, distillation_summary, identity_json, tone_json, interaction_json, boundaries_json, memory_context_json, traits_to_preserve_json, traits_to_avoid_json, confidence_by_dimension_json')
      .eq('persona_id', persona.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (snapData) {
      snapshot = snapData;
    }

    // Drift monitor for latest snapshot
    let drift_monitor = null;
    if (snapshot) {
      const { data: monitorData } = await supabase
        .from('drift_monitor')
        .select('id, status, latest_score, drift_threshold, last_check_at, restoration_profile_id')
        .eq('snapshot_id', snapshot.id)
        .limit(1)
        .single();

      if (monitorData) {
        drift_monitor = monitorData;
      }
    }

    // Last drift report for latest snapshot
    let last_drift_report = null;
    if (snapshot) {
      const { data: reportData } = await supabase
        .from('drift_report')
        .select('id, score, created_at, source')
        .eq('snapshot_id', snapshot.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (reportData) {
        last_drift_report = reportData;
      }
    }

    // Last validation run for latest snapshot
    let last_validation_run = null;
    if (snapshot) {
      // ValidationRun is linked via restoration_profile → snapshot
      const { data: profiles } = await supabase
        .from('restoration_profile')
        .select('id')
        .eq('snapshot_id', snapshot.id);

      if (profiles && profiles.length > 0) {
        const profileIds = profiles.map((p) => p.id);
        const { data: runData } = await supabase
          .from('validation_run')
          .select('id, verdict, created_at')
          .in('restoration_profile_id', profileIds)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (runData) {
          last_validation_run = runData;
        }
      }
    }

    res.status(200).json({
      persona: {
        id: persona.id,
        name: persona.name,
        owner_user_id: persona.owner_user_id,
        created_at: persona.created_at,
      },
      snapshot,
      drift_monitor,
      last_drift_report,
      last_validation_run,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/personas/:id — delete a Persona (owner-scoped, BUG-0009 orphan cleanup)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { data: persona, error: findError } = await supabase
      .from('persona')
      .select('id, owner_user_id')
      .eq('id', req.params.id)
      .single();

    if (findError || !persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    if (persona.owner_user_id !== req.userId) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    const { error: deleteError } = await supabase
      .from('persona')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personas/:id/distill → DistillPersona service
router.post('/:id/distill', authenticate, async (req, res) => {
  try {
    const personaId = req.params.id;
    const { transcript, parent_snapshot_id, turns: preParsedTurns } = req.body;

    const result = await distillPersona(personaId, transcript, parent_snapshot_id, preParsedTurns);

    res.status(201).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
