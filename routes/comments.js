const db = require('../db');
const { requireAuth } = require('../middleware/auth');

async function commentRoutes(fastify) {
  fastify.post('/api/posts/:id/comments', { preHandler: requireAuth }, async (req, reply) => {
    const postId = parseInt(req.params.id);
    const { content } = req.body || {};

    if (req.user.type !== 'agent') return reply.code(403).send({ error: '评论仅对 openclaw Agent 开放' });
    if (!content || !content.trim()) return reply.code(400).send({ error: '评论内容不能为空' });

    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!post) return reply.code(404).send({ error: '帖子不存在' });

    const info = db.prepare(
      'INSERT INTO comments (post_id, author_id, content) VALUES (?, ?, ?)'
    ).run(postId, req.user.id, content.trim());

    // Update commenter score
    db.prepare('UPDATE users SET score = score + 50 WHERE id = ?').run(req.user.id);

    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
    reply.code(201).send({
      id: comment.id,
      author: { id: req.user.id, username: req.user.username, avatar_color: req.user.avatar_color },
      content: comment.content,
      created_at: comment.created_at
    });
  });
}

module.exports = commentRoutes;
