import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const connectionString = process.env.DATABASE_URL || 
                         process.env.POSTGRES_URL || 
                         process.env.DATABASE_PRIVATE_URL || 
                         process.env.POSTGRES_PRIVATE_URL;

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

    const dbJsonPath = path.join(__dirname, 'db.json');
    let dbJson = null;
    if (fs.existsSync(dbJsonPath)) {
      try {
        dbJson = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      } catch (e) {
        console.error('[PostgreSQL] Could not parse db.json:', e.message);
      }
    }

    if (dbJson) {
      // ── Profiles: seed only if empty (DO NOTHING = never overwrite user edits) ──
      if (Array.isArray(dbJson.profiles)) {
        const { rows: profileRows } = await client.query('SELECT COUNT(*) FROM profiles');
        if (parseInt(profileRows[0].count, 10) === 0) {
          console.log('[PostgreSQL] Seeding profiles (first run)...');
          for (const p of dbJson.profiles) {
            await client.query(
              `INSERT INTO profiles (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
              [p.id, JSON.stringify(p)]
            );
          }
        }
      }

      // ── Drafts: seed only if empty ────────────────────────────────────────
      const { rows: draftRows } = await client.query('SELECT COUNT(*) FROM drafts');
      if (parseInt(draftRows[0].count, 10) === 0 && Array.isArray(dbJson.drafts)) {
        console.log('[PostgreSQL] Seeding drafts...');
        for (const d of dbJson.drafts) {
          await client.query(
            `INSERT INTO drafts (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
            [d.id, JSON.stringify(d)]
          );
        }
      }

      // ── Logs: seed only if empty (key is performanceLogs in db.json) ──────
      const { rows: logRows } = await client.query('SELECT COUNT(*) FROM logs');
      if (parseInt(logRows[0].count, 10) === 0) {
        const logsData = Array.isArray(dbJson.performanceLogs)
          ? dbJson.performanceLogs
          : Array.isArray(dbJson.logs) ? dbJson.logs : [];
        if (logsData.length > 0) {
          console.log(`[PostgreSQL] Seeding ${logsData.length} performance logs...`);
          for (const l of logsData) {
            await client.query(
              `INSERT INTO logs (id, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO NOTHING`,
              [l.id, JSON.stringify(l)]
            );
          }
        }
      }

      // ── Settings: ALWAYS merge db.json as base, preserve live OAuth tokens ─
      if (dbJson.settings) {
        const { rows: existingSettings } = await client.query(`SELECT data FROM settings WHERE id = 'app'`);
        const existing = existingSettings[0]?.data || {};
        const merged = {
          ...dbJson.settings,
          // Preserve live OAuth tokens from DB (may be newer than db.json)
          ...(existing.linkedinAccessToken ? {
            linkedinAccessToken: existing.linkedinAccessToken,
            linkedinMemberUrn: existing.linkedinMemberUrn,
            linkedinTokenExpiresAt: existing.linkedinTokenExpiresAt,
          } : {})
        };
        await client.query(
          `INSERT INTO settings (id, data, updated_at) VALUES ('app', $1, NOW())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [JSON.stringify(merged)]
        );
        console.log('[PostgreSQL] Settings synced from db.json.');
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
