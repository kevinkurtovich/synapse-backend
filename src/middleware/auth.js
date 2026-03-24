// FEAT-0007: JWT validation middleware
// Validates Supabase JWT from Authorization: Bearer header.
// Attaches req.userId on success. Returns 401 on failure.
// Uses the service-role supabase client — auth.getUser() works with service key.

const supabase = require('../supabase');

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.userId = user.id;
  next();
}

module.exports = { authenticate };
