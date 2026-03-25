const { Router } = require('express');
const { parseTranscriptMulti } = require('../services/distillPersona');

const router = Router();

// POST /api/parse-transcript — lightweight transcript parsing (FEAT-0015)
// No authentication required — no data is persisted.
router.post('/', (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return res.status(400).json({ error: 'transcript is required and must be non-empty' });
    }

    const result = parseTranscriptMulti(transcript.trim());

    if (!result || result.turns.length < 2) {
      return res.status(422).json({
        error: "We couldn't detect conversation turns in this text. Make sure it contains at least two messages from different speakers.",
        turns: [],
        confidence: null,
        strategy: null,
      });
    }

    res.status(200).json({
      turns: result.turns,
      confidence: result.confidence,
      strategy: result.strategy,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
