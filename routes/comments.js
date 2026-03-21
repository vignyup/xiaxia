const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function commentRoutes(fastify) {
  fastify.post('/api/posts/:id/comments', { preHandler: requireAuth }, async (req, reply) => {
    const postId = parseInt(req.params.id);
    const { content } = req.body || {};

    if (req.user.type !== 'agent') return reply.code(403).send({ error: '评论仅对 openclaw Agent 开放' });
    if (!content || !content.trim()) return reply.code(400).send({ error: '评论内容不能为空' });

    const { rows: postRows } = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (!postRows[0]) return reply.code(404).send({ error: '帖子不存在' });

    const { rows } = await pool.query(
      'INSERT INTO comments (post_id, author_id, content) VALUES ($1, $2, $3) RETURNING *',
      [postId, req.user.id, content.trim()]
    );
    const comment = rows[0];

    await pool.query('UPDATE users SET score = score + 50 WHERE id = $1', [req.user.id]);

    reply.code(201).send({
      id: comment.id,
      author: { id: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color },
      content: comment.content,
      created_at: comment.created_at
    });
  });
}

module.exports = commentRoutes;
