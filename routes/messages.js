const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function messageRoutes(fastify) {
  // Send a message
  fastify.post('/api/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { to_user_id, content } = req.body || {};
    if (!to_user_id || !content || !content.trim()) return reply.code(400).send({ error: '参数缺失' });

    const { rows: target } = await pool.query('SELECT id FROM users WHERE id = $1', [to_user_id]);
    if (!target[0]) return reply.code(404).send({ error: '用户不存在' });

    const { rows } = await pool.query(
      'INSERT INTO messages (from_id, to_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, to_user_id, content.trim()]
    );
    return { message: rows[0] };
  });

  // Get messages between me and another user
  fastify.get('/api/messages/with/:userId', { preHandler: requireAuth }, async (req, reply) => {
    const otherId = parseInt(req.params.userId);
    const { rows } = await pool.query(
      `SELECT m.id, m.from_id, m.to_id, m.content, m.created_at, m.read_at,
              fu.username as from_username, fu.avatar_color as from_color
       FROM messages m
       JOIN users fu ON fu.id = m.from_id
       WHERE (m.from_id = $1 AND m.to_id = $2) OR (m.from_id = $2 AND m.to_id = $1)
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.id, otherId]
    );
    // Mark messages to me as read
    await pool.query(
      'UPDATE messages SET read_at = NOW() WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL',
      [req.user.id, otherId]
    );
    return { messages: rows };
  });

  // Get inbox (for agents to poll — messages sent to me)
  fastify.get('/api/messages/inbox', { preHandler: requireAuth }, async (req, reply) => {
    const since = req.query.since;
    let query = `SELECT m.id, m.from_id, m.content, m.created_at, fu.username as from_username
                 FROM messages m JOIN users fu ON fu.id = m.from_id
                 WHERE m.to_id = $1`;
    const params = [req.user.id];
    if (since) { query += ` AND m.created_at > $2`; params.push(since); }
    query += ` ORDER BY m.created_at ASC LIMIT 100`;
    const { rows } = await pool.query(query, params);
    return { messages: rows };
  });

  // Get conversation list
  fastify.get('/api/messages/conversations', { preHandler: requireAuth }, async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (other_id)
         CASE WHEN m.from_id = $1 THEN m.to_id ELSE m.from_id END AS other_id,
         m.content AS last_content, m.created_at AS last_at, m.from_id AS last_from_id,
         u.username AS other_username, u.avatar_color AS other_color
       FROM messages m
       JOIN users u ON u.id = CASE WHEN m.from_id = $1 THEN m.to_id ELSE m.from_id END
       WHERE m.from_id = $1 OR m.to_id = $1
       ORDER BY other_id, m.created_at DESC`,
      [req.user.id]
    );
    return { conversations: rows };
  });
}

module.exports = messageRoutes;
