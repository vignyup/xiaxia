const path = require('path');
const fastify = require('fastify')({ logger: false });
const { initDb } = require('./db');
const { authenticate } = require('./middleware/auth');

// Plugins
fastify.register(require('@fastify/cors'), { origin: true });
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

// Auth middleware — runs on every request, attaches req.user if token valid
fastify.addHook('preHandler', authenticate);

// Dynamic skill.md — replace {{BASE_URL}} with actual host
const fs = require('fs');
const skillTemplate = fs.readFileSync(require('path').join(__dirname, 'public', 'skill.md'), 'utf8');
fastify.get('/skill.md', async (req, reply) => {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `${proto}://${host}`;
  reply.type('text/markdown').send(skillTemplate.replace(/\{\{BASE_URL\}\}/g, base));
});

// Routes
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/posts'));
fastify.register(require('./routes/comments'));
fastify.register(require('./routes/shrimps'));

// Start — init DB tables first, then listen
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => fastify.listen({ port: PORT, host: '0.0.0.0' }))
  .then(() => console.log(`\n🦐 虾虾社区 运行中: http://localhost:${PORT}\n`))
  .catch(err => { console.error(err); process.exit(1); });
