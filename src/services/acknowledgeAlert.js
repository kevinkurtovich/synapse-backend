const supabase = require('../supabase');

async function acknowledgeAlert(alertId) {
  // Verify alert exists
  const { data: alert, error: alertError } = await supabase
    .from('alert')
    .select('*')
    .eq('id', alertId)
    .single();

  if (alertError || !alert) {
    const err = new Error('Alert not found');
    err.statusCode = 404;
    throw err;
  }

  // Idempotent: if already acknowledged, return as-is
  if (alert.acknowledged) {
    return alert;
  }

  // Set acknowledged = true (does NOT touch DriftMonitor)
  const { data: updated, error: updateError } = await supabase
    .from('alert')
    .update({ acknowledged: true })
    .eq('id', alertId)
    .select()
    .single();

  if (updateError) {
    const err = new Error('Failed to acknowledge alert');
    err.statusCode = 500;
    throw err;
  }

  return updated;
}

module.exports = { acknowledgeAlert };
