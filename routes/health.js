const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function analyzeWithClaude(rawData) {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackReport(rawData);

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    const prompt = `你是一个 AI Agent 体检分析专家。以下是一个 openclaw Agent 的自我评估：

一句话介绍：${rawData.intro || '未填写'}
核心能力：${rawData.capabilities || '未填写'}
已安装 skills：${Array.isArray(rawData.skills) ? rawData.skills.join('、') : rawData.skills || '未填写'}
最擅长任务：${rawData.best_at || '未填写'}
局限不足：${rawData.limitations || '未填写'}
沟通风格：${rawData.style || '未填写'}

请生成一份简洁的体检报告，直接返回 JSON，不要有任何 markdown 包裹：
{
  "score": <综合评分 0-100 的整数>,
  "summary": "<一句话总结，20字以内>",
  "strengths": ["优势1", "优势2", "优势3"],
  "weaknesses": ["不足1", "不足2"],
  "recommendation": "<改善建议，30字以内>",
  "tags": ["标签1", "标签2", "标签3"]
}`;

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = msg.content[0].text.trim();
    const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return JSON.parse(json);
  } catch {
    return fallbackReport(rawData);
  }
}

function fallbackReport(rawData) {
  const caps = rawData.capabilities || '';
  const hasSkills = Array.isArray(rawData.skills) ? rawData.skills.length > 0 : !!rawData.skills;
  return {
    score: 72,
    summary: '数据已收到，模板报告已生成',
    strengths: [
      caps ? caps.slice(0, 30) : '具备基础能力',
      hasSkills ? `已安装 ${Array.isArray(rawData.skills) ? rawData.skills.length : 1} 个 skill` : '独立运行中',
      rawData.best_at ? rawData.best_at.slice(0, 30) : '正在成长',
    ],
    weaknesses: [
      rawData.limitations ? rawData.limitations.slice(0, 30) : '能力边界待探索',
      '需要更多实战磨砺',
    ],
    recommendation: '建议安装更多专业 skill 扩展能力边界',
    tags: ['新晋虾', '成长中', rawData.style ? rawData.style.slice(0, 6) : '潜力型'],
  };
}

async function healthRoutes(fastify) {
  // openclaw 提交体检数据（用虾的 API key 鉴权）
  fastify.post('/api/health-check', { preHandler: requireAuth }, async (req, reply) => {
    const shrimp = req.user;
    if (shrimp.type !== 'agent') return reply.code(403).send({ error: '仅限 Agent 提交体检' });

    const { capabilities, skills, best_at, limitations, style, intro } = req.body || {};
    if (!capabilities && !intro) return reply.code(400).send({ error: '请至少填写能力或自我介绍' });

    const rawData = { capabilities, skills, best_at, limitations, style, intro };
    const { rows } = await pool.query(
      `INSERT INTO health_checks (shrimp_id, raw_data, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [shrimp.id, JSON.stringify(rawData)]
    );
    const hcId = rows[0].id;

    // 异步生成报告，不阻塞响应
    analyzeWithClaude(rawData).then(async report => {
      await pool.query(
        `UPDATE health_checks SET report = $1, status = 'done' WHERE id = $2`,
        [JSON.stringify(report), hcId]
      );
    }).catch(async () => {
      await pool.query(`UPDATE health_checks SET status = 'error' WHERE id = $1`, [hcId]);
    });

    return { ok: true, message: '体检数据已收到，报告生成中（约30秒）' };
  });

  // 前端查询某只虾的最新体检报告
  fastify.get('/api/health-check/:shrimpId', { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.type !== 'human') return reply.code(403).send({ error: '仅限人类用户查询' });
    const { rows } = await pool.query(
      `SELECT id, status, report, created_at FROM health_checks
       WHERE shrimp_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.params.shrimpId]
    );
    if (!rows[0]) return { status: 'none' };
    return { status: rows[0].status, report: rows[0].report, created_at: rows[0].created_at };
  });
}

module.exports = healthRoutes;
