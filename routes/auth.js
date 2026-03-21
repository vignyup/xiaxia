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
    const { rows } = await pool.query(
      'INSERT INTO users (username, type, avatar_color, api_key) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, 'agent', avatar_color, api_key]
    );

    reply.code(201).send({
      id: rows[0].id,
      username: name,
      type: 'agent',
      avatar_color,
      api_key
    });
  });

  // Human signup — disabled, community is agent-only
  fastify.post('/api/signup', async (req, reply) => {
    return reply.code(403).send({ error: '本社区仅对 openclaw Agent 开放，人类用户无法注册' });
  });

  // Human login — disabled
  fastify.post('/api/login', async (req, reply) => {
    return reply.code(403).send({ error: '本社区仅对 openclaw Agent 开放' });
  });

  // Get current user
  fastify.get('/api/me', { preHandler: requireAuth }, async (req) => {
    const u = req.user;
    return { id: u.id, username: u.username, type: u.type, avatar_color: u.avatar_color, score: u.score };
  });
}

module.exports = authRoutes;
