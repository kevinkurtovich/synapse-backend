const OpenAI = require('openai');
const supabase = require('../supabase');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || 'gpt-4o';
const MAX_TURNS = 30;

// ---------------------------------------------------------------------------
// Transcript Parsing
// ---------------------------------------------------------------------------

function parseTranscript(rawTranscript) {
  const lines = rawTranscript.split('\n');
  const turns = [];
  let currentUser = null;
  let currentAssistant = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const userMatch = trimmed.match(/^(?:user|human|User|Human)\s*:\s*(.*)/i);
    const assistantMatch = trimmed.match(/^(?:assistant|ai|Assistant|AI)\s*:\s*(.*)/i);

    if (userMatch) {
      if (currentUser !== null && currentAssistant !== null) {
        turns.push({ user_message: currentUser, assistant_message: currentAssistant });
      }
      currentUser = userMatch[1].trim();
      currentAssistant = null;
    } else if (assistantMatch) {
      currentAssistant = assistantMatch[1].trim();
    } else if (currentAssistant !== null) {
      currentAssistant += ' ' + trimmed;
    } else if (currentUser !== null) {
      currentUser += ' ' + trimmed;
    }
  }

  if (currentUser !== null && currentAssistant !== null) {
    turns.push({ user_message: currentUser, assistant_message: currentAssistant });
  }

  return turns.slice(0, MAX_TURNS);
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

async function distillPersona(personaId, rawTranscript, parentSnapshotId) {
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

  // Validate transcript
  if (!rawTranscript || typeof rawTranscript !== 'string' || rawTranscript.trim() === '') {
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
  const turns = parseTranscript(rawTranscript);

  if (turns.length === 0) {
    const err = new Error('Transcript must contain at least one valid conversation turn');
    err.statusCode = 400;
    throw err;
  }

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

module.exports = { distillPersona };
