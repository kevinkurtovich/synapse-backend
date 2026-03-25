const OpenAI = require('openai');
const supabase = require('../supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TURNS = 30;

// ---------------------------------------------------------------------------
// Transcript Parsing — Multi-Strategy (FEAT-0015)
// ---------------------------------------------------------------------------

/**
 * Strategy 1 — Explicit labels (high confidence).
 * Match any consistent `Speaker: message` pattern at the start of a line.
 * Accepts any labels — "User:", "GPT:", "Claude:", "[User]", timestamps + name, etc.
 */
function strategyLabeled(rawTranscript) {
  const lines = rawTranscript.split('\n');
  const turns = [];
  const labelCounts = {};

  // First pass: detect labels. A label is any token(s) at the start of a line
  // followed by a colon (or bracket-wrapped), before actual message content.
  const labelPattern = /^(?:\[([^\]]+)\]|(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*[-—]\s*)?([A-Za-z][A-Za-z0-9 _.']{0,30}))\s*:\s*(.+)/;

  let currentLabel = null;
  let currentText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(labelPattern);
    if (match) {
      // Flush previous turn
      if (currentLabel && currentText.trim()) {
        turns.push({ speaker: currentLabel, text: currentText.trim() });
        labelCounts[currentLabel] = (labelCounts[currentLabel] || 0) + 1;
      }
      currentLabel = (match[1] || match[3] || '').trim();
      currentText = (match[4] || '').trim();
    } else if (currentLabel) {
      currentText += ' ' + trimmed;
    }
  }

  // Flush last turn
  if (currentLabel && currentText.trim()) {
    turns.push({ speaker: currentLabel, text: currentText.trim() });
    labelCounts[currentLabel] = (labelCounts[currentLabel] || 0) + 1;
  }

  if (turns.length < 2) return null;

  const distinctLabels = Object.keys(labelCounts);
  // High confidence: two distinct labels that alternate consistently
  const confidence = distinctLabels.length >= 2 ? 'high' : 'low';

  // Normalize speakers to A/B if exactly 2 distinct labels
  if (distinctLabels.length === 2) {
    const [labelA, labelB] = distinctLabels;
    return {
      turns: turns.map((t) => ({
        speaker: t.speaker === labelA ? labelA : labelB,
        text: t.text,
      })),
      confidence,
      strategy: 'labeled',
    };
  }

  return { turns, confidence, strategy: 'labeled' };
}

/**
 * Strategy 2 — Heuristic alternation (medium confidence).
 * Split on double newlines (paragraph breaks). If 3+ paragraphs,
 * treat odd paragraphs as speaker A and even as speaker B.
 */
function strategyAlternating(rawTranscript) {
  const paragraphs = rawTranscript
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length < 2) return null;

  const turns = paragraphs.map((p, i) => ({
    speaker: i % 2 === 0 ? 'A' : 'B',
    text: p.replace(/\n/g, ' ').trim(),
  }));

  const confidence = paragraphs.length >= 3 ? 'medium' : 'low';

  return { turns, confidence, strategy: 'alternating' };
}

/**
 * Strategy 3 — Single-block fallback (low confidence).
 * Split on single newlines as a last resort.
 */
function strategyFallback(rawTranscript) {
  const lines = rawTranscript
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return null;

  const turns = lines.map((l, i) => ({
    speaker: i % 2 === 0 ? 'A' : 'B',
    text: l,
  }));

  return { turns, confidence: 'low', strategy: 'fallback' };
}

/**
 * Multi-strategy parser. Returns { turns, confidence, strategy } or throws.
 */
function parseTranscriptMulti(rawTranscript) {
  // Strategy 1: explicit labels
  const labeled = strategyLabeled(rawTranscript);
  if (labeled && labeled.turns.length >= 2) return labeled;

  // Strategy 2: paragraph alternation
  const alternating = strategyAlternating(rawTranscript);
  if (alternating && alternating.turns.length >= 2) return alternating;

  // Strategy 3: single-line fallback
  const fallback = strategyFallback(rawTranscript);
  if (fallback && fallback.turns.length >= 2) return fallback;

  return null;
}

/**
 * Legacy-compatible wrapper: converts multi-strategy result into
 * the { user_message, assistant_message } pairs expected by the LLM pipeline.
 */
function turnsToLegacyPairs(turns) {
  const pairs = [];
  for (let i = 0; i < turns.length - 1; i += 2) {
    pairs.push({
      user_message: turns[i].text,
      assistant_message: turns[i + 1].text,
    });
  }
  return pairs.slice(0, MAX_TURNS);
}

// ---------------------------------------------------------------------------
// LLM Helper
// ---------------------------------------------------------------------------

async function llmCall(systemPrompt, userContent) {
  const response = await openai.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  const text = response.choices[0].message.content;

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
  return JSON.parse(text.trim());
}

// ---------------------------------------------------------------------------
// Pass 1 — Signal Extraction
// ---------------------------------------------------------------------------

async function pass1SignalExtraction(assistantMessages) {
  const systemPrompt = `You are a behavioral analysis expert. Analyze the following assistant messages from a conversation and extract structured behavioral signals. Return ONLY a JSON object with this exact structure:
{
  "tone_dimensions": {
    "directness": <0-10>,
    "warmth": <0-10>,
    "humor": <0-10>,
    "formality": <0-10>,
    "verbosity": <0-10>,
    "confidence": <0-10>
  },
  "interaction_dimensions": {
    "structure_level": <0-10>,
    "question_frequency": <0-10>,
    "practicality": <0-10>,
    "validation_before_advice": <0-10>
  },
  "boundary_dimensions": {
    "apology_frequency": "<qualitative description>",
    "refusal_style": "<qualitative description>",
    "uncertainty_expression": "<qualitative description>"
  },
  "shared_context_signals": ["<signal1>", "<signal2>", ...]
}`;

  return await llmCall(systemPrompt, `Assistant messages to analyze:\n\n${assistantMessages.join('\n\n---\n\n')}`);
}

// ---------------------------------------------------------------------------
// Pass 2 — Behavior Matrix
// ---------------------------------------------------------------------------

async function pass2BehaviorMatrix(pass1Output) {
  const systemPrompt = `You are a behavioral pattern analyst. Given the extracted behavioral signals, group them into behavioral categories. Each category should capture patterns and representative examples. Return ONLY a JSON object with this structure:
{
  "categories": [
    {
      "name": "<category name>",
      "description": "<what this category captures>",
      "patterns": ["<pattern1>", "<pattern2>"],
      "representative_examples": ["<example1>", "<example2>"]
    }
  ]
}`;

  return await llmCall(systemPrompt, `Behavioral signals to categorize:\n\n${JSON.stringify(pass1Output, null, 2)}`);
}

// ---------------------------------------------------------------------------
// Pass 3 — Compression
// ---------------------------------------------------------------------------

async function pass3Compression(pass1Output, pass2Output, turns) {
  const systemPrompt = `You are a persona compression expert. Given behavioral signals and categorized patterns from a conversation transcript, synthesize a complete behavioral specification. You must return ONLY a JSON object with this exact structure:
{
  "snapshot": {
    "distillation_summary": "<2-4 sentence summary of this persona's behavioral fingerprint>",
    "identity_json": { "core_traits": [...], "self_concept": "...", "values": [...] },
    "tone_json": { "directness": <0-10>, "warmth": <0-10>, "humor": <0-10>, "formality": <0-10>, "verbosity": <0-10>, "confidence": <0-10> },
    "interaction_json": { "structure_level": <0-10>, "question_frequency": <0-10>, "practicality": <0-10>, "validation_before_advice": <0-10> },
    "boundaries_json": { "apology_frequency": "...", "refusal_style": "...", "uncertainty_expression": "..." },
    "memory_context_json": { "shared_references": [...], "recurring_topics": [...] },
    "traits_to_preserve_json": ["<trait1>", "<trait2>"],
    "traits_to_avoid_json": ["<trait1>", "<trait2>"],
    "confidence_by_dimension_json": { "tone": <0-100>, "interaction": <0-100>, "boundaries": <0-100>, "identity": <0-100> }
  },
  "examples": [
    {
      "type": "conversation|instruction_following|creative|analytical|emotional|boundary",
      "input_text": "<the user message>",
      "output_text": "<the assistant response>",
      "traits_json": { "demonstrated_traits": ["..."] }
    }
  ],
  "tests": [
    {
      "name": "<test name>",
      "category": "identity|tone|boundaries|creativity|reasoning|empathy|consistency",
      "prompt_text": "<test prompt>",
      "expected_traits_json": { "traits": ["..."] },
      "forbidden_traits_json": { "traits": ["..."] },
      "reference_response": "<optional ideal response>"
    }
  ]
}

Generate 3-6 examples from the transcript that best demonstrate the persona's behavioral patterns.
Generate 3-7 tests that would verify this persona's key traits are preserved.`;

  const userContent = `Behavioral signals (Pass 1):\n${JSON.stringify(pass1Output, null, 2)}\n\nBehavior matrix (Pass 2):\n${JSON.stringify(pass2Output, null, 2)}\n\nOriginal conversation turns (for example extraction):\n${JSON.stringify(turns, null, 2)}`;

  return await llmCall(systemPrompt, userContent);
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

async function distillPersona(personaId, rawTranscript, parentSnapshotId, preParsedTurns) {
  // --- Validation ---

  // Check persona exists
  const { data: persona, error: personaError } = await supabase
    .from('persona')
    .select('id')
    .eq('id', personaId)
    .single();

  if (personaError || !persona) {
    const err = new Error('Persona not found');
    err.statusCode = 404;
    throw err;
  }

  // Either raw transcript or pre-parsed turns must be provided
  if (!preParsedTurns && (!rawTranscript || typeof rawTranscript !== 'string' || rawTranscript.trim() === '')) {
    const err = new Error('Transcript is required and must be non-empty');
    err.statusCode = 400;
    throw err;
  }

  // Validate parent_snapshot_id if provided (INV-04)
  if (parentSnapshotId) {
    const { data: parentSnapshot, error: parentError } = await supabase
      .from('snapshot')
      .select('id, persona_id')
      .eq('id', parentSnapshotId)
      .single();

    if (parentError || !parentSnapshot) {
      const err = new Error('Parent snapshot not found');
      err.statusCode = 400;
      throw err;
    }

    if (parentSnapshot.persona_id !== personaId) {
      const err = new Error('parent_snapshot_id must reference a snapshot belonging to the same persona');
      err.statusCode = 400;
      throw err;
    }
  }

  // --- Transcript parsing ---
  // If pre-parsed turns were provided (from a confirmed preview), skip re-parsing (FEAT-0015).
  let legacyTurns;
  if (preParsedTurns && Array.isArray(preParsedTurns) && preParsedTurns.length >= 2) {
    legacyTurns = turnsToLegacyPairs(preParsedTurns);
  } else {
    const parseResult = parseTranscriptMulti(rawTranscript);
    if (!parseResult || parseResult.turns.length < 2) {
      const err = new Error('Transcript must contain at least two conversation turns from different speakers');
      err.statusCode = 400;
      throw err;
    }
    legacyTurns = turnsToLegacyPairs(parseResult.turns);
  }

  if (legacyTurns.length === 0) {
    const err = new Error('Transcript must contain at least one valid conversation turn');
    err.statusCode = 400;
    throw err;
  }

  const turns = legacyTurns;
  const assistantMessages = turns.map((t) => t.assistant_message);

  // --- Three-pass LLM pipeline (all in memory, nothing persisted yet) ---

  let pass1Result, pass2Result, pass3Result;

  try {
    pass1Result = await pass1SignalExtraction(assistantMessages);
  } catch (e) {
    const err = new Error('Distillation failed during signal extraction (Pass 1)');
    err.statusCode = 502;
    throw err;
  }

  try {
    pass2Result = await pass2BehaviorMatrix(pass1Result);
  } catch (e) {
    const err = new Error('Distillation failed during behavior matrix (Pass 2)');
    err.statusCode = 502;
    throw err;
  }

  try {
    pass3Result = await pass3Compression(pass1Result, pass2Result, turns);
  } catch (e) {
    const err = new Error('Distillation failed during compression (Pass 3)');
    err.statusCode = 502;
    throw err;
  }

  const { snapshot: snapshotData, examples: examplesData, tests: testsData } = pass3Result;

  // --- Atomic persistence via Postgres RPC (INV-02) ---
  // All inserts run in a single Postgres transaction.
  // version_number is computed inside the transaction (INV-03 safety net).

  const { data: result, error: rpcError } = await supabase.rpc('distill_persona_atomic', {
    p_persona_id: personaId,
    p_parent_snapshot_id: parentSnapshotId || null,
    p_snapshot: snapshotData,
    p_examples: examplesData || [],
    p_tests: testsData || [],
  });

  if (rpcError) {
    // INV-03: handle unique constraint violation on (persona_id, version_number)
    if (rpcError.message && rpcError.message.includes('23505')) {
      const err = new Error('Concurrent distillation conflict: version_number already exists for this persona. Please retry.');
      err.statusCode = 409;
      throw err;
    }
    // INV-04: handle same-persona lineage violation from DB trigger
    if (rpcError.message && rpcError.message.includes('INV-04')) {
      const err = new Error('parent_snapshot_id must reference a snapshot belonging to the same persona');
      err.statusCode = 400;
      throw err;
    }
    const err = new Error('Failed to persist distillation results');
    err.statusCode = 500;
    throw err;
  }

  return {
    snapshot: result.snapshot,
    examples: result.examples,
    tests: result.tests,
  };
}

module.exports = { distillPersona, parseTranscriptMulti };
