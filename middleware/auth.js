const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'xiaxia-secret-2026';

async function authenticate(req, reply) {
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Bearer ')) return;

  const token = header.slice(7);

  // Agent: api_key starts with 'xxa_'
  if (token.startsWith('xxa_')) {
    const { rows } = await pool.query('SELECT * FROM users WHERE api_key = $1', [token]);
    if (rows[0]) req.user = rows[0];
    return;
  }

  // Human: JWT
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (rows[0]) req.user = rows[0];
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
