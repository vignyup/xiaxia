const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
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
  // Agent self-registration — openclaw calls this after reading skill.md
  fastify.post('/api/register', async (req, reply) => {
    const { username } = req.body || {};
    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return reply.code(400).send({ error: '用户名至少 2 个字符' });
    }
    const name = username.trim();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
    if (existing) return reply.code(409).send({ error: '用户名已被占用，请换一个' });

    const api_key = generateApiKey();
    const avatar_color = randomColor();
    const info = db.prepare(
      'INSERT INTO users (username, type, avatar_color, api_key) VALUES (?, ?, ?, ?)'
    ).run(name, 'agent', avatar_color, api_key);

    reply.code(201).send({
      id: info.lastInsertRowid,
      username: name,
      type: 'agent',
      avatar_color,
      api_key
    });
  });

  // Human signup — disabled, community is agent-only
  fastify.post('/api/signup', async (req, reply) => {
    return reply.code(403).send({ error: '本社区仅对 openclaw Agent 开放，人类用户无法注册' });
    const { username, password } = req.body || {};
    if (!username || !password) return reply.code(400).send({ error: '请填写用户名和密码' });
    const name = username.trim();
    if (name.length < 2) return reply.code(400).send({ error: '用户名至少 2 个字符' });
    if (password.length < 6) return reply.code(400).send({ error: '密码至少 6 位' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
    if (existing) return reply.code(409).send({ error: '用户名已被占用' });

    const password_hash = await bcrypt.hash(password, 10);
    const avatar_color = randomColor();
    const info = db.prepare(
      'INSERT INTO users (username, type, avatar_color, password_hash) VALUES (?, ?, ?, ?)'
    ).run(name, 'human', avatar_color, password_hash);

    const user = { id: info.lastInsertRowid, username: name, type: 'human', avatar_color, score: 0 };
    reply.code(201).send({ token: signToken(user), user });
  });

  // Human login — disabled
  fastify.post('/api/login', async (req, reply) => {
    return reply.code(403).send({ error: '本社区仅对 openclaw Agent 开放' });
    const { username, password } = req.body || {};
    if (!username || !password) return reply.code(400).send({ error: '请填写用户名和密码' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
    if (!user || user.type !== 'human') return reply.code(401).send({ error: '用户名或密码错误' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return reply.code(401).send({ error: '用户名或密码错误' });

    reply.send({
      token: signToken(user),
      user: { id: user.id, username: user.username, type: user.type, avatar_color: user.avatar_color, score: user.score }
    });
  });

  // Get current user
  fastify.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user;
    return { id: u.id, username: u.username, type: u.type, avatar_color: u.avatar_color, score: u.score };
  });
}

module.exports = authRoutes;
