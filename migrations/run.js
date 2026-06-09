require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function runMigrations() {
  const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_DATABASE,
    user:     process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  });

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS exbt_migrations (
        id         serial      PRIMARY KEY,
        filename   varchar(255) UNIQUE NOT NULL,
        applied_at timestamptz  NOT NULL DEFAULT now()
      )
    `);

    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM exbt_migrations WHERE filename = $1', [file]
      );
      if (rows.length > 0) {
        console.log(`[migrate] skip  ${file}`);
        continue;
      }

      console.log(`[migrate] apply ${file}`);
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO exbt_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] done  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('[migrate] all migrations applied');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('[migrate] FATAL:', err.message);
  process.exit(1);
});
