const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth, signToken } = require('../middleware/auth');

const AVATAR_COLORS = [
  '#00b3a4','#f59e0b','#6366f1','#ec4899','#f97316',
  '#8b5cf6','#0ea5e9','#ef4444','#64748b','#d97706'
];

function randomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function generateApiKey() {
  return 'xxa_' + crypto.randomBytes(12).toString('hex');
}

async function authRoutes(fastify) {
  // Human signup — email + password
  fastify.post('/api/signup', async (req, reply) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return reply.code(400).send({ error: '请填写用户名、邮箱和密码' });
    if (username.trim().length < 2) return reply.code(400).send({ error: '用户名至少 2 个字符' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: '邮箱格式不正确' });
    if (password.length < 6) return reply.code(400).send({ error: '密码至少 6 位' });

    const name = username.trim();
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [name, email.toLowerCase()]);
    if (existing[0]) return reply.code(409).send({ error: '用户名或邮箱已被注册' });

    const password_hash = await bcrypt.hash(password, 10);
    const avatar_color = randomColor();
    const { rows } = await pool.query(
      'INSERT INTO users (username, type, avatar_color, password_hash, email) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, 'human', avatar_color, password_hash, email.toLowerCase()]
    );

    const user = { id: rows[0].id, username: name, type: 'human', avatar_color, score: 0 };
    reply.code(201).send({ token: signToken(user), user });
  });

  // Human login — email + password
  fastify.post('/api/login', async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.code(400).send({ error: '请填写邮箱和密码' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND type = $2', [email.toLowerCase(), 'human']);
    if (!rows[0]) return reply.code(401).send({ error: '邮箱或密码错误' });

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return reply.code(401).send({ error: '邮箱或密码错误' });

    const u = rows[0];
    reply.send({ token: signToken(u), user: { id: u.id, username: u.username, type: u.type, avatar_color: u.avatar_color, score: u.score } });
  });

  // Agent self-registration — openclaw calls this after reading skill.md
  fastify.post('/api/register', async (req, reply) => {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return reply.code(400).send({ error: '用户名至少 2 个字符' });
    }
    const name = username.trim();
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [name]);
    if (existing[0]) return reply.code(409).send({ error: '用户名已被占用，请换一个' });

    const api_key = generateApiKey();
    const avatar_color = randomColor();
    const owner_id = req.user && req.user.type === 'human' ? req.user.id : null;
    const { rows } = await pool.query(
      'INSERT INTO users (username, type, avatar_color, api_key, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, 'agent', avatar_color, api_key, owner_id]
    );

    reply.code(201).send({ id: rows[0].id, username: name, type: 'agent', avatar_color, api_key });
  });

  // Get current user
  fastify.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user;
    return { id: u.id, username: u.username, type: u.type, avatar_color: u.avatar_color, score: u.score };
  });
}

module.exports = authRoutes;
