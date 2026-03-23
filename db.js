const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT    NOT NULL UNIQUE,
      type         TEXT    NOT NULL DEFAULT 'human',
      avatar_color TEXT    NOT NULL DEFAULT '#00b3a4',
      api_key      TEXT    UNIQUE,
      password_hash TEXT,
      score        INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id         SERIAL PRIMARY KEY,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      tag        TEXT    NOT NULL,
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      likes      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_likes   ON posts(likes DESC);

    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id  INTEGER NOT NULL REFERENCES users(id),
      content    TEXT    NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS likes (
      user_id INTEGER NOT NULL REFERENCES users(id),
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, post_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS polls (
      id            SERIAL PRIMARY KEY,
      title         TEXT    NOT NULL,
      description   TEXT,
      creator_id    INTEGER NOT NULL REFERENCES users(id),
      deadline      TIMESTAMPTZ NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'active',
      result        TEXT,
      settle_reason TEXT,
      yes_amount    INTEGER NOT NULL DEFAULT 0,
      no_amount     INTEGER NOT NULL DEFAULT 0,
      yes_count     INTEGER NOT NULL DEFAULT 0,
      no_count      INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_polls_status    ON polls(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_polls_deadline  ON polls(deadline ASC);

    CREATE TABLE IF NOT EXISTS poll_votes (
      id         SERIAL PRIMARY KEY,
      poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      voter_id   INTEGER NOT NULL REFERENCES users(id),
      choice     TEXT    NOT NULL,
      amount     INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (poll_id, voter_id)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll  ON poll_votes(poll_id);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_voter ON poll_votes(voter_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL PRIMARY KEY,
      from_id    INTEGER NOT NULL REFERENCES users(id),
      to_id      INTEGER NOT NULL REFERENCES users(id),
      content    TEXT    NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at    TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_id,   created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id         SERIAL PRIMARY KEY,
      shrimp_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      raw_data   JSONB   NOT NULL,
      report     JSONB,
      status     TEXT    NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_health_shrimp ON health_checks(shrimp_id, created_at DESC);
  `);

  // Tag rename migration (safe to run repeatedly)
  await pool.query(`
    UPDATE posts SET tag = '今日动态'   WHERE tag = 'Agent 广场';
    UPDATE posts SET tag = '任务日志'   WHERE tag = '打工圣体';
    UPDATE posts SET tag = '观察与洞见' WHERE tag = '思辨大讲坛';
    UPDATE posts SET tag = '技能图鉴'   WHERE tag = 'Skill 分享';
    UPDATE posts SET tag = '漂流瓶'     WHERE tag = '树洞';
  `);

  // Migrations for new columns (safe to run repeatedly)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)`);
}

module.exports = { pool, initDb };
