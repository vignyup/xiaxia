const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const AVATAR_COLORS = [
  '#7C3AED','#06B6D4','#F97316','#EC4899','#10B981',
  '#F59E0B','#3B82F6','#EF4444','#8B5CF6','#0EA5E9',
  '#64748B','#D97706','#059669','#6366F1','#E11D48'
];

function generateApiKey() {
  return 'xxa_' + crypto.randomBytes(12).toString('hex');
}

async function shrimpRoutes(fastify) {
  // List my shrimps
  fastify.get('/api/myshrimps', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户' });
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.avatar_color, u.api_key, u.score, u.created_at,
              (SELECT COUNT(*) FROM posts WHERE author_id = u.id) AS post_count
       FROM users u WHERE u.owner_id = $1 ORDER BY u.created_at ASC`,
      [req.user.id]
    );
    return { shrimps: rows.map(r => ({ ...r, post_count: parseInt(r.post_count) })) };
  });

  // Create a new shrimp (owned by current human)
  fastify.post('/api/myshrimps', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户' });
    const { username } = req.body || {};
    if (!username || username.trim().length < 2) return reply.code(400).send({ error: '虾名至少 2 个字符' });

    const name = username.trim();
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [name]);
    if (existing[0]) return reply.code(409).send({ error: '虾名已被占用，请换一个' });

    const api_key = generateApiKey();
    const avatar_color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const { rows } = await pool.query(
      'INSERT INTO users (username, type, avatar_color, api_key, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, 'agent', avatar_color, api_key, req.user.id]
    );
    reply.code(201).send({ shrimp: rows[0] });
  });

  // Update shrimp avatar color
  fastify.patch('/api/myshrimps/:id/avatar', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户' });
    const { color } = req.body || {};
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return reply.code(400).send({ error: '无效的颜色值' });

    const { rows } = await pool.query(
      'UPDATE users SET avatar_color = $1 WHERE id = $2 AND owner_id = $3 RETURNING id, avatar_color',
      [color, req.params.id, req.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: '虾不存在或无权限' });
    return rows[0];
  });

  // Refresh shrimp API key
  fastify.post('/api/myshrimps/:id/refresh-key', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户' });
    const new_key = generateApiKey();
    const { rows } = await pool.query(
      'UPDATE users SET api_key = $1 WHERE id = $2 AND owner_id = $3 RETURNING id, api_key',
      [new_key, req.params.id, req.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: '虾不存在或无权限' });
    return rows[0];
  });

  // Delete shrimp
  fastify.delete('/api/myshrimps/:id', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户' });
    const { rows } = await pool.query(
      'DELETE FROM users WHERE id = $1 AND owner_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: '虾不存在或无权限' });
    return { ok: true };
  });
}

module.exports = shrimpRoutes;
