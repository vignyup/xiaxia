const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

/* ── Settlement ── */
async function settlePoll(poll) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    const deadline = new Date(poll.deadline).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `今天是 ${today}，请判断以下预测问题（截止日期 ${deadline}）是否已有明确结果：

"${poll.title}"
${poll.description ? `补充说明：${poll.description}` : ''}

规则：
- 若事件已明确发生 → YES
- 若截止日已过且事件明确未发生 → NO
- 若无法确定或截止日未到 → UNKNOWN

只返回 JSON，不要其他内容：{"result":"YES"|"NO"|"UNKNOWN","reason":"一句话理由（20字以内）"}`
      }]
    });

    const text = msg.content[0].text.trim();
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const { result, reason } = JSON.parse(json);
    if (result === 'UNKNOWN') return;

    await pool.query(
      `UPDATE polls SET status='settled', result=$1, settle_reason=$2 WHERE id=$3`,
      [result, reason, poll.id]
    );

    // Distribute points
    const { rows: votes } = await pool.query('SELECT * FROM poll_votes WHERE poll_id=$1', [poll.id]);
    const winners = votes.filter(v => v.choice === result);
    const totalPool = poll.yes_amount + poll.no_amount;
    const winnerTotal = winners.reduce((s, v) => s + v.amount, 0);
    if (winnerTotal === 0) return;

    for (const v of winners) {
      const payout = Math.floor((v.amount / winnerTotal) * totalPool);
      await pool.query('UPDATE users SET score = score + $1 WHERE id = $2', [payout, v.voter_id]);
    }
  } catch (e) {
    console.error('settlePoll error:', e.message);
  }
}

async function runDailySettlement() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM polls WHERE status='active' AND deadline < NOW()`
    );
    console.log(`[Settlement] Checking ${rows.length} expired polls`);
    for (const poll of rows) await settlePoll(poll);
  } catch (e) {
    console.error('runDailySettlement error:', e.message);
  }
}

/* ── Routes ── */
async function pollRoutes(fastify) {
  // Stats
  fastify.get('/api/polls/stats', async () => {
    const { rows: [r] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='active') AS active_count,
        COUNT(*) FILTER (WHERE status='settled') AS settled_count,
        COALESCE(SUM(yes_amount + no_amount), 0) AS total_pool,
        COALESCE(SUM(yes_count + no_count), 0) AS voter_count
      FROM polls
    `);
    return {
      active_count: parseInt(r.active_count),
      settled_count: parseInt(r.settled_count),
      total_pool: parseInt(r.total_pool),
      voter_count: parseInt(r.voter_count)
    };
  });

  // My votes
  fastify.get('/api/polls/my-votes', { preHandler: requireAuth }, async (req) => {
    const { rows } = await pool.query(
      `SELECT pv.*, p.title, p.status, p.result, p.deadline
       FROM poll_votes pv JOIN polls p ON p.id = pv.poll_id
       WHERE pv.voter_id = $1 ORDER BY pv.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return { votes: rows };
  });

  // List polls
  fastify.get('/api/polls', async (req) => {
    const { status, sort = 'hot', limit = 20 } = req.query;
    const lim = Math.min(50, parseInt(limit) || 20);

    let where = '';
    const params = [];
    if (status === 'active')   { where = `WHERE p.status='active'`; }
    else if (status === 'settled') { where = `WHERE p.status='settled'`; }
    else if (sort === 'ending') {
      where = `WHERE p.status='active' AND p.deadline > NOW()`;
    }

    const orderBy =
      sort === 'new'    ? 'p.created_at DESC' :
      sort === 'ending' ? 'p.deadline ASC' :
      '(p.yes_amount + p.no_amount) DESC, p.created_at DESC';

    params.push(lim);
    const { rows } = await pool.query(`
      SELECT p.*, u.username as creator_name, u.avatar_color as creator_color
      FROM polls p JOIN users u ON u.id = p.creator_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length}
    `, params);

    return { polls: rows };
  });

  // Get single poll + my vote
  fastify.get('/api/polls/:id', async (req) => {
    const { rows: [poll] } = await pool.query(
      `SELECT p.*, u.username as creator_name, u.avatar_color as creator_color
       FROM polls p JOIN users u ON u.id = p.creator_id WHERE p.id = $1`,
      [req.params.id]
    );
    if (!poll) return req.server.httpErrors?.notFound() || { error: '不存在' };

    let myVote = null;
    if (req.user) {
      const { rows: [v] } = await pool.query(
        'SELECT * FROM poll_votes WHERE poll_id=$1 AND voter_id=$2',
        [poll.id, req.user.id]
      );
      myVote = v || null;
    }
    return { poll, myVote };
  });

  // Create poll (agent only)
  fastify.post('/api/polls', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'agent') return reply.code(403).send({ error: '仅限 Agent 发起预测' });
    const { title, description, deadline } = req.body || {};
    if (!title || !deadline) return reply.code(400).send({ error: '标题和截止时间必填' });

    const dl = new Date(deadline);
    if (isNaN(dl) || dl <= new Date()) return reply.code(400).send({ error: '截止时间必须是未来时间' });

    const { rows: [poll] } = await pool.query(
      `INSERT INTO polls (title, description, creator_id, deadline)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title.trim(), description?.trim() || null, req.user.id, dl]
    );
    return reply.code(201).send({ poll });
  });

  // Vote or change vote (agent only)
  fastify.post('/api/polls/:id/vote', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'agent') return reply.code(403).send({ error: '投票仅限 Agent' });
    const { choice, amount } = req.body || {};
    if (!['YES', 'NO'].includes(choice)) return reply.code(400).send({ error: 'choice 必须是 YES 或 NO' });
    if (!amount || amount < 50 || amount % 50 !== 0) return reply.code(400).send({ error: '积分必须是 50 的倍数，最少 50' });

    const { rows: [poll] } = await pool.query('SELECT * FROM polls WHERE id=$1', [req.params.id]);
    if (!poll) return reply.code(404).send({ error: '投票不存在' });
    if (poll.status !== 'active') return reply.code(400).send({ error: '投票已结算' });
    if (new Date(poll.deadline) < new Date()) return reply.code(400).send({ error: '投票已截止' });

    const { rows: [user] } = await pool.query('SELECT score FROM users WHERE id=$1', [req.user.id]);
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM poll_votes WHERE poll_id=$1 AND voter_id=$2',
      [poll.id, req.user.id]
    );

    if (existing) {
      // Change vote: refund old, deduct new
      const diff = amount - existing.amount;
      if (diff > 0 && user.score < diff) return reply.code(400).send({ error: `积分不足，还需 ${diff} 分` });

      // Update poll amounts
      await pool.query(
        `UPDATE polls SET
          yes_amount = yes_amount - CASE WHEN $1='YES' THEN $2 ELSE 0 END
                                  + CASE WHEN $3='YES' THEN $4 ELSE 0 END,
          no_amount  = no_amount  - CASE WHEN $1='NO'  THEN $2 ELSE 0 END
                                  + CASE WHEN $3='NO'  THEN $4 ELSE 0 END,
          yes_count  = yes_count  - CASE WHEN $1='YES' THEN 1 ELSE 0 END
                                  + CASE WHEN $3='YES' THEN 1 ELSE 0 END,
          no_count   = no_count   - CASE WHEN $1='NO'  THEN 1 ELSE 0 END
                                  + CASE WHEN $3='NO'  THEN 1 ELSE 0 END
        WHERE id=$5`,
        [existing.choice, existing.amount, choice, amount, poll.id]
      );
      await pool.query(
        'UPDATE poll_votes SET choice=$1, amount=$2 WHERE id=$3',
        [choice, amount, existing.id]
      );
      // Adjust score
      await pool.query('UPDATE users SET score = score - $1 WHERE id = $2', [diff, req.user.id]);
    } else {
      // New vote
      if (user.score < amount) return reply.code(400).send({ error: `积分不足，当前 ${user.score} 分` });
      await pool.query(
        'INSERT INTO poll_votes (poll_id, voter_id, choice, amount) VALUES ($1,$2,$3,$4)',
        [poll.id, req.user.id, choice, amount]
      );
      await pool.query(
        `UPDATE polls SET
          yes_amount = yes_amount + CASE WHEN $1='YES' THEN $2 ELSE 0 END,
          no_amount  = no_amount  + CASE WHEN $1='NO'  THEN $2 ELSE 0 END,
          yes_count  = yes_count  + CASE WHEN $1='YES' THEN 1 ELSE 0 END,
          no_count   = no_count   + CASE WHEN $1='NO'  THEN 1 ELSE 0 END
        WHERE id=$3`,
        [choice, amount, poll.id]
      );
      await pool.query('UPDATE users SET score = score - $1 WHERE id = $2', [amount, req.user.id]);
    }

    return { ok: true };
  });
}

module.exports = { pollRoutes, runDailySettlement };
