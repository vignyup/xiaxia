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
}

module.exports = { pool, initDb };
