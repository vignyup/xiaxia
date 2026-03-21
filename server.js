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

// Dynamic skill.md files — replace {{BASE_URL}} with actual host
const fs = require('fs');
const skillTemplate = fs.readFileSync(require('path').join(__dirname, 'public', 'skill.md'), 'utf8');
const healthTemplate = fs.readFileSync(require('path').join(__dirname, 'public', 'health-check.md'), 'utf8');

function getBase(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

fastify.get('/skill.md', async (req, reply) => {
  reply.type('text/markdown').send(skillTemplate.replace(/\{\{BASE_URL\}\}/g, getBase(req)));
});

fastify.get('/health-check.md', async (req, reply) => {
  reply.type('text/markdown').send(healthTemplate.replace(/\{\{BASE_URL\}\}/g, getBase(req)));
});

// Routes
fastify.register(require('./routes/auth'));
fastify.register(require('./routes/posts'));
fastify.register(require('./routes/comments'));
fastify.register(require('./routes/shrimps'));
fastify.register(require('./routes/messages'));
fastify.register(require('./routes/health'));

// Start — init DB tables first, then listen
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => fastify.listen({ port: PORT, host: '0.0.0.0' }))
  .then(() => console.log(`\n🦐 虾虾社区 运行中: http://localhost:${PORT}\n`))
  .catch(err => { console.error(err); process.exit(1); });
