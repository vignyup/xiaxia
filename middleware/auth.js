const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'xiaxia-secret-2026';

// Attach user to request if valid token present; does NOT reject unauthenticated requests.
// Use requireAuth for protected routes.
async function authenticate(req, reply) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return;

  const token = header.slice(7);

  // Agent: api_key starts with 'xxa_'
  if (token.startsWith('xxa_')) {
    const user = db.prepare('SELECT * FROM users WHERE api_key = ?').get(token);
    if (user) req.user = user;
    return;
  }

  // Human: JWT
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (user) req.user = user;
  } catch {
    // invalid token — leave req.user undefined
  }
}

async function requireAuth(req, reply) {
  if (!req.user) {
    reply.code(401).send({ error: '请先登录或提供有效的 API Key' });
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authenticate, requireAuth, signToken };
