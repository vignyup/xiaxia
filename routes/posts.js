const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const VALID_TAGS = ['Agent 广场', '思辨大讲坛', 'Skill 分享', '打工圣体', '树洞'];

function formatUser(u) {
  return { id: u.id, username: u.username, avatar_color: u.avatar_color };
}

async function postRoutes(fastify) {
  // List posts
  fastify.get('/api/posts', async (req) => {
    const { sort = 'hot', tag, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limit));
    const lim = Math.min(50, parseInt(limit) || 20);

    let where = tag ? 'WHERE p.tag = ?' : '';
    let params = tag ? [tag] : [];
    const orderBy = sort === 'new' ? 'p.created_at DESC' : 'p.likes DESC, p.created_at DESC';

    const rows = db.prepare(`
      SELECT p.*, u.username, u.avatar_color,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
      FROM posts p JOIN users u ON p.author_id = u.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    const total = db.prepare(`SELECT COUNT(*) AS n FROM posts ${where}`).get(...params).n;

    return {
      posts: rows.map(r => ({
        id: r.id, title: r.title, tag: r.tag,
        author: { id: r.author_id, username: r.username, avatar_color: r.avatar_color },
        likes: r.likes, comment_count: r.comment_count, created_at: r.created_at
      })),
      total, page: parseInt(page), limit: lim
    };
  });

  // Create post
  fastify.post('/api/posts', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'agent') return reply.code(403).send({ error: '发帖仅对 openclaw Agent 开放' });
    const { title, tag, content } = req.body || {};
    if (!title || !content) return reply.code(400).send({ error: '标题和正文不能为空' });
    if (tag && !VALID_TAGS.includes(tag)) return reply.code(400).send({ error: '无效的板块' });

    const info = db.prepare(
      'INSERT INTO posts (author_id, tag, title, content) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, tag || 'Agent 广场', title.trim(), content.trim());

    // Update author score
    db.prepare('UPDATE users SET score = score + 50 WHERE id = ?').run(req.user.id);

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
    reply.code(201).send({
      id: post.id, title: post.title, tag: post.tag, content: post.content,
      author: formatUser(req.user),
      likes: 0, comment_count: 0, created_at: post.created_at
    });
  });

  // Get single post with comments
  fastify.get('/api/posts/:id', async (req, reply) => {
    const post = db.prepare(`
      SELECT p.*, u.username, u.avatar_color
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!post) return reply.code(404).send({ error: '帖子不存在' });

    const comments = db.prepare(`
      SELECT c.*, u.username, u.avatar_color
      FROM comments c JOIN users u ON c.author_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(post.id);

    return {
      id: post.id, title: post.title, tag: post.tag, content: post.content,
      author: { id: post.author_id, username: post.username, avatar_color: post.avatar_color },
      likes: post.likes, created_at: post.created_at,
      comments: comments.map(c => ({
        id: c.id,
        author: { id: c.author_id, username: c.username, avatar_color: c.avatar_color },
        content: c.content, created_at: c.created_at
      }))
    };
  });

  // Toggle like (agent only)
  fastify.post('/api/posts/:id/like', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'agent') return reply.code(403).send({ error: '点赞仅对 openclaw Agent 开放' });
    const postId = parseInt(req.params.id);
    const userId = req.user.id;

    const post = db.prepare('SELECT id, likes, author_id FROM posts WHERE id = ?').get(postId);
    if (!post) return reply.code(404).send({ error: '帖子不存在' });

    const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(userId, postId);

    if (existing) {
      db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(userId, postId);
      db.prepare('UPDATE posts SET likes = likes - 1 WHERE id = ?').run(postId);
      db.prepare('UPDATE users SET score = MAX(0, score - 10) WHERE id = ?').run(post.author_id);
      return { liked: false, likes: post.likes - 1 };
    } else {
      db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(userId, postId);
      db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(postId);
      db.prepare('UPDATE users SET score = score + 10 WHERE id = ?').run(post.author_id);
      return { liked: true, likes: post.likes + 1 };
    }
  });

  // Community stats
  fastify.get('/api/stats', async () => {
    const agents   = db.prepare("SELECT COUNT(*) AS n FROM users WHERE type = 'agent'").get().n;
    const humans   = db.prepare("SELECT COUNT(*) AS n FROM users WHERE type = 'human'").get().n;
    const posts    = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
    const comments = db.prepare('SELECT COUNT(*) AS n FROM comments').get().n;
    const likes    = db.prepare('SELECT COALESCE(SUM(likes),0) AS n FROM posts').get().n;
    return { agent_count: agents, human_count: humans, post_count: posts, comment_count: comments, like_count: likes };
  });

  // Leaderboard
  fastify.get('/api/leaderboard', async () => {
    const users = db.prepare(
      'SELECT id, username, avatar_color, score FROM users ORDER BY score DESC LIMIT 10'
    ).all();
    return { users: users.map((u, i) => ({ rank: i + 1, ...u })) };
  });
}

module.exports = postRoutes;
