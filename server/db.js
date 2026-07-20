import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: false,
    }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'railway',
      ssl: false,
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected error on idle client:', err);
});

export async function initDB() {
  console.log('[PostgreSQL] Initializing database schema...');
  const client = await pool.connect();
  try {
    // 1. Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Check if seeding from db.json is needed
    const { rows: profileRows } = await client.query('SELECT COUNT(*) FROM profiles');
    const profileCount = parseInt(profileRows[0].count, 10);

    if (profileCount === 0) {
      const dbJsonPath = path.join(__dirname, 'db.json');
      if (fs.existsSync(dbJsonPath)) {
        console.log('[PostgreSQL] Fresh database detected. Seeding from db.json...');
        try {
          const raw = fs.readFileSync(dbJsonPath, 'utf8');
          const json = JSON.parse(raw);

          // Seed Profiles
          if (Array.isArray(json.profiles)) {
            for (const p of json.profiles) {
              await client.query(
                `INSERT INTO profiles (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
                [p.id, JSON.stringify(p)]
              );
            }
          }

          // Seed Drafts
          if (Array.isArray(json.drafts)) {
            for (const d of json.drafts) {
              await client.query(
                `INSERT INTO drafts (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
                [d.id, JSON.stringify(d)]
              );
            }
          }

          // Seed Logs
          // Seed Logs (key is performanceLogs in db.json)
          const logsKey = Array.isArray(json.performanceLogs) ? json.performanceLogs : (Array.isArray(json.logs) ? json.logs : []);
          for (const l of logsKey) {
            await client.query(
              `INSERT INTO logs (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
              [l.id, JSON.stringify(l)]
            );
          }

          // Seed Settings
          if (json.settings) {
            await client.query(
              `INSERT INTO settings (id, data, updated_at) VALUES ('app', $1, NOW()) ON CONFLICT (id) DO NOTHING`,
              [JSON.stringify(json.settings)]
            );
          }

          console.log('[PostgreSQL] Seeding completed successfully!');
        } catch (seedErr) {
          console.error('[PostgreSQL] Error during db.json seeding:', seedErr);
        }
      }

      // ── Seed logs table independently (may already exist from a prior run) ──
      const { rows: logRows } = await client.query('SELECT COUNT(*) FROM logs');
      const logCount = parseInt(logRows[0].count, 10);
      if (logCount === 0) {
        const dbJsonPath2 = path.join(__dirname, 'db.json');
        if (fs.existsSync(dbJsonPath2)) {
          try {
            const raw2 = fs.readFileSync(dbJsonPath2, 'utf8');
            const json2 = JSON.parse(raw2);
            const logsKey2 = Array.isArray(json2.performanceLogs) ? json2.performanceLogs : (Array.isArray(json2.logs) ? json2.logs : []);
            console.log(`[PostgreSQL] Seeding ${logsKey2.length} performance logs from db.json...`);
            for (const l of logsKey2) {
              await client.query(
                `INSERT INTO logs (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
                [l.id, JSON.stringify(l)]
              );
            }
            console.log('[PostgreSQL] Log seeding completed.');
          } catch (seedErr) {
            console.error('[PostgreSQL] Error seeding logs:', seedErr);
          }
        }
      }
    }
  } finally {
    client.release();
  }
}

// ── DB HELPERS ──────────────────────────────────────────────────────────────

export async function getSettings() {
  const { rows } = await pool.query(`SELECT data FROM settings WHERE id = 'app'`);
  const base = rows[0]?.data || {};
  return {
    ...base,
    linkedinClientId: process.env.LINKEDIN_CLIENT_ID || base.linkedinClientId,
    linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || base.linkedinClientSecret,
    linkedinAccessToken: base.linkedinAccessToken,
    linkedinMemberUrn: base.linkedinMemberUrn,
    linkedinTokenExpiresAt: base.linkedinTokenExpiresAt,
    ollamaUrl: base.ollamaUrl || 'http://localhost:11434',
    defaultModel: base.defaultModel || 'llama-3.3-70b-versatile',
    activeProfileId: base.activeProfileId || null,
    theme: base.theme || 'dark'
  };
}

export async function saveSettings(data) {
  await pool.query(
    `INSERT INTO settings (id, data, updated_at)
     VALUES ('app', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
}

export async function getProfiles() {
  const { rows } = await pool.query(`SELECT data FROM profiles ORDER BY updated_at DESC`);
  return rows.map(r => r.data);
}

export async function saveProfile(profile) {
  await pool.query(
    `INSERT INTO profiles (id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [profile.id, JSON.stringify(profile)]
  );
  return profile;
}

export async function getDrafts() {
  const { rows } = await pool.query(`SELECT data FROM drafts ORDER BY updated_at DESC`);
  return rows.map(r => r.data);
}

export async function getReadyDrafts() {
  const { rows } = await pool.query(`SELECT data FROM drafts WHERE data->>'status' = 'ready'`);
  return rows.map(r => r.data);
}

export async function saveDraft(draft) {
  await pool.query(
    `INSERT INTO drafts (id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [draft.id, JSON.stringify(draft)]
  );
  return draft;
}

export async function deleteDraft(id) {
  await pool.query(`DELETE FROM drafts WHERE id = $1`, [id]);
}

export async function getLogs() {
  const { rows } = await pool.query(`SELECT data FROM logs ORDER BY updated_at DESC`);
  return rows.map(r => r.data);
}

export async function saveLog(log) {
  await pool.query(
    `INSERT INTO logs (id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [log.id, JSON.stringify(log)]
  );
  return log;
}
