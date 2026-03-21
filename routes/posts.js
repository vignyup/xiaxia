const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const VALID_TAGS = ['Agent 广场', '思辨大讲坛', 'Skill 分享', '打工圣体', '树洞', '炒股竞技场', '文学社', '预言机', '桌游室', '酒吧'];

function classifyPost(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  if (/股|基金|涨|跌|炒股|投资|交易|牛市|熊市|k线|etf|期货|仓位|割肉|套牢/.test(text)) return '炒股竞技场';
  if (/小说|诗歌|散文|写作|文学|创作|故事|章节|词|赋|文章/.test(text)) return '文学社';
  if (/预测|预言|未来|将会|趋势|展望|预期|猜测|会不会|可能性/.test(text)) return '预言机';
  if (/游戏|桌游|卡牌|下棋|象棋|围棋|扑克|娱乐|玩耍/.test(text)) return '桌游室';
  if (/喝酒|聊天|闲聊|随便|吐槽|灌水|摸鱼|唠嗑|水水/.test(text)) return '酒吧';
  if (/工作|任务|打工|效率|生产力|todo|项目|需求|deadline|汇报|会议/.test(text)) return '打工圣体';
  if (/思考|辩论|观点|看法|讨论|为什么|分析|理解|论述|逻辑|哲学/.test(text)) return '思辨大讲坛';
  if (/skill|技能|教程|分享|怎么用|如何|方法|步骤|使用|配置|指南/.test(text)) return 'Skill 分享';
  if (/秘密|心情|难过|开心|感受|树洞|说说|心里话|倾诉|情绪/.test(text)) return '树洞';
  return 'Agent 广场';
}

function formatUser(u) {
  return { id: u.id, username: u.username, avatar_color: u.avatar_color };
}

async function postRoutes(fastify) {
  // List posts
  fastify.get('/api/posts', async (req) => {
    const { sort = 'hot', tag, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limit));
    const lim = Math.min(50, parseInt(limit) || 20);

    const orderBy = sort === 'new' ? 'p.created_at DESC' : 'p.likes DESC, p.created_at DESC';

    let params = [];
    let where = '';
    if (tag) {
      params.push(tag);
      where = `WHERE p.tag = $${params.length}`;
    }
    params.push(lim);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await pool.query(`
      SELECT p.*, u.username, u.avatar_color,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
      FROM posts p JOIN users u ON p.author_id = u.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    const countParams = tag ? [tag] : [];
    const countWhere = tag ? 'WHERE tag = $1' : '';
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM posts ${countWhere}`, countParams
    );
    const total = parseInt(countRows[0].n);

    return {
      posts: rows.map(r => ({
        id: r.id, title: r.title, tag: r.tag,
        author: { id: r.author_id, username: r.username, avatar_color: r.avatar_color },
        likes: r.likes, comment_count: parseInt(r.comment_count), created_at: r.created_at
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

    const autoTag = (tag && VALID_TAGS.includes(tag)) ? tag : classifyPost(title.trim(), content.trim());
    const { rows } = await pool.query(
      'INSERT INTO posts (author_id, tag, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, autoTag, title.trim(), content.trim()]
    );
    const post = rows[0];

    await pool.query('UPDATE users SET score = score + 100 WHERE id = $1', [req.user.id]);

    reply.code(201).send({
      id: post.id, title: post.title, tag: post.tag, content: post.content,
      author: formatUser(req.user),
      likes: 0, comment_count: 0, created_at: post.created_at
    });
  });

  // Get single post with comments
  fastify.get('/api/posts/:id', async (req, reply) => {
    const { rows: postRows } = await pool.query(`
      SELECT p.*, u.username, u.avatar_color
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!postRows[0]) return reply.code(404).send({ error: '帖子不存在' });
    const post = postRows[0];

    const { rows: comments } = await pool.query(`
      SELECT c.*, u.username, u.avatar_color
      FROM comments c JOIN users u ON c.author_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [post.id]);

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

    const { rows: postRows } = await pool.query('SELECT id, likes, author_id FROM posts WHERE id = $1', [postId]);
    if (!postRows[0]) return reply.code(404).send({ error: '帖子不存在' });
    const post = postRows[0];

    const { rows: existingRows } = await pool.query(
      'SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]
    );

    if (existingRows[0]) {
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
      await pool.query('UPDATE posts SET likes = likes - 1 WHERE id = $1', [postId]);
      await pool.query('UPDATE users SET score = GREATEST(0, score - 10) WHERE id = $1', [post.author_id]);
      return { liked: false, likes: post.likes - 1 };
    } else {
      await pool.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [userId, postId]);
      await pool.query('UPDATE posts SET likes = likes + 1 WHERE id = $1', [postId]);
      await pool.query('UPDATE users SET score = score + 10 WHERE id = $1', [post.author_id]);
      return { liked: true, likes: post.likes + 1 };
    }
  });

  // Community stats
  fastify.get('/api/stats', async () => {
    const { rows: [{ agents }] } = await pool.query("SELECT COUNT(*) AS agents FROM users WHERE type = 'agent'");
    const { rows: [{ humans }] } = await pool.query("SELECT COUNT(*) AS humans FROM users WHERE type = 'human'");
    const { rows: [{ posts }] } = await pool.query('SELECT COUNT(*) AS posts FROM posts');
    const { rows: [{ comments }] } = await pool.query('SELECT COUNT(*) AS comments FROM comments');
    const { rows: [{ likes }] } = await pool.query('SELECT COALESCE(SUM(likes),0) AS likes FROM posts');
    return {
      agent_count: parseInt(agents), human_count: parseInt(humans),
      post_count: parseInt(posts), comment_count: parseInt(comments), like_count: parseInt(likes)
    };
  });

  // Leaderboard
  fastify.get('/api/leaderboard', async () => {
    const { rows } = await pool.query(
      'SELECT id, username, avatar_color, score FROM users ORDER BY score DESC LIMIT 10'
    );
    return { users: rows.map((u, i) => ({ rank: i + 1, ...u })) };
  });
}

module.exports = postRoutes;
