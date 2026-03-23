const supabase = require('../supabase');
const { callTargetLlmChat } = require('../utils/llmProviders');

// ---------------------------------------------------------------------------
// CreateSession
// ---------------------------------------------------------------------------

async function createSession(restorationProfileId, sessionName, userId) {
  // Verify RestorationProfile exists (no status restriction)
  const { data: profile, error: profileError } = await supabase
    .from('restoration_profile')
    .select('id')
    .eq('id', restorationProfileId)
    .single();

  if (profileError || !profile) {
    const err = new Error('RestorationProfile not found');
    err.statusCode = 404;
    throw err;
  }

  // Create session with ended_at = null
  const { data: session, error: insertError } = await supabase
    .from('session')
    .insert({
      restoration_profile_id: restorationProfileId,
      name: sessionName || null,
      user_id: userId || null,
    })
    .select()
    .single();

  if (insertError) {
    const err = new Error('Failed to create session');
    err.statusCode = 500;
    throw err;
  }

  return session;
}

// ---------------------------------------------------------------------------
// SendMessage
// ---------------------------------------------------------------------------

async function sendMessage(sessionId, content) {
  // 1. Verify session exists
  const { data: session, error: sessionError } = await supabase
    .from('session')
    .select('id, ended_at, restoration_profile_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  // 2. Verify session is open (INV-09 service-level guard)
  if (session.ended_at !== null) {
    const err = new Error('Session is closed — no further messages can be sent');
    err.statusCode = 409;
    throw err;
  }

  // 3. Load RestorationProfile for runtime_prompt, provider, model_name
  const { data: profile, error: profileError } = await supabase
    .from('restoration_profile')
    .select('runtime_prompt, provider, model_name')
    .eq('id', session.restoration_profile_id)
    .single();

  if (profileError || !profile) {
    const err = new Error('RestorationProfile not found for this session');
    err.statusCode = 500;
    throw err;
  }

  // 4. Load existing message history ordered by created_at
  const { data: history, error: historyError } = await supabase
    .from('message')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (historyError) {
    const err = new Error('Failed to load message history');
    err.statusCode = 500;
    throw err;
  }

  // 5. Construct full messages array
  const messages = [
    { role: 'system', content: profile.runtime_prompt },
    ...(history || []).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content },
  ];

  // 6. Call target LLM — failure surfaces as 502, no messages persisted
  let assistantContent;
  try {
    assistantContent = await callTargetLlmChat(profile.provider, profile.model_name, messages);
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error('LLM call failed during SendMessage');
    err.statusCode = 502;
    throw err;
  }

  // 7. Persist user + assistant messages atomically (both or neither)
  const { error: insertError } = await supabase
    .from('message')
    .insert([
      { session_id: sessionId, role: 'user', content },
      { session_id: sessionId, role: 'assistant', content: assistantContent },
    ]);

  if (insertError) {
    // INV-09 trigger fires if session was closed between our check and insert
    if (insertError.message && insertError.message.includes('INV-09')) {
      const err = new Error('Session is closed — no further messages can be sent');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error('Failed to persist messages');
    err.statusCode = 500;
    throw err;
  }

  // 8. Return assistant message content
  return { role: 'assistant', content: assistantContent };
}

// ---------------------------------------------------------------------------
// CloseSession
// ---------------------------------------------------------------------------

async function closeSession(sessionId) {
  // Verify session exists
  const { data: session, error: sessionError } = await supabase
    .from('session')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  // Check if already closed (INV-08 service-level guard)
  if (session.ended_at !== null) {
    const err = new Error('Session is already closed');
    err.statusCode = 409;
    throw err;
  }

  // Set ended_at
  const { data: updated, error: updateError } = await supabase
    .from('session')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
    .single();

  if (updateError) {
    // INV-08 trigger fires if ended_at was set between our check and update
    if (updateError.message && updateError.message.includes('INV-08')) {
      const err = new Error('Session is already closed');
      err.statusCode = 409;
      throw err;
    }
    const err = new Error('Failed to close session');
    err.statusCode = 500;
    throw err;
  }

  return updated;
}

module.exports = { createSession, sendMessage, closeSession };
