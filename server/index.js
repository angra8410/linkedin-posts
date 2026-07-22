import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupLinkedInRoutes } from './linkedin.js';
import {
  initDB,
  getSettings,
  saveSettings,
  getProfiles,
  saveProfile,
  getDrafts,
  getReadyDrafts,
  saveDraft,
  deleteDraft,
  getLogs,
  saveLog
} from './db.js';

// ── ENV VALIDATION ──────────────────────────────────────────────────────────
const REQUIRED_ENV = ['GROQ_API_KEY'];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key]) {
    console.error(`[Server] Missing required env var: ${key}`);
    process.exit(1);
  }
});

// ── GROQ LLM HELPER ─────────────────────────────────────────────────────────
async function callGroq({ model, prompt, system }) {
  const groqModel = model || process.env.GROQ_DEFAULT_MODEL || 'llama-3.3-70b-versatile';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: groqModel,
      messages,
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── EXPRESS APP ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

app.use('/api/linkedin/proxy-video-upload-chunk', express.raw({ type: 'application/octet-stream', limit: '10mb' }));

app.use(bodyParser.json({ limit: '10mb' }));

// ── DEBUG (TEMP) ─────────────────────────────────────────────────────────────
const formatError = (e) => {
  if (!e) return "";
  if (e.name === 'AggregateError' || e.constructor?.name === 'AggregateError' || Array.isArray(e.errors)) {
    const innerMsg = Array.isArray(e.errors)
      ? e.errors.map(err => err.message || err.toString()).join(' | ')
      : 'no inner errors array';
    return `AggregateError: ${e.message || 'no message'}. Inner: ${innerMsg}`;
  }
  return e.toString();
};

app.get('/api/debug', async (req, res) => {
  const results = {};
  
  // Environment variables check (masked for security)
  let dbUrlParsed = {};
  if (process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      dbUrlParsed = {
        protocol: u.protocol,
        host: u.hostname,
        port: u.port,
        pathname: u.pathname,
        username: u.username
      };
    } catch (parseErr) {
      dbUrlParsed = { error: parseErr.message };
    }
  }

  results.env = {
    DATABASE_URL_present: !!process.env.DATABASE_URL,
    DATABASE_URL_parsed: dbUrlParsed,
    PGHOST: process.env.PGHOST,
    PGPORT: process.env.PGPORT,
    PGUSER: process.env.PGUSER,
    PGDATABASE: process.env.PGDATABASE,
    LINKEDIN_CLIENT_ID_present: !!process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_ID_val: process.env.LINKEDIN_CLIENT_ID ? `${process.env.LINKEDIN_CLIENT_ID.slice(0, 4)}...${process.env.LINKEDIN_CLIENT_ID.slice(-4)}` : null,
    LINKEDIN_CLIENT_SECRET_present: !!process.env.LINKEDIN_CLIENT_SECRET,
    LINKEDIN_CLIENT_SECRET_val: process.env.LINKEDIN_CLIENT_SECRET ? `${process.env.LINKEDIN_CLIENT_SECRET.slice(0, 4)}...` : null,
    NODE_ENV: process.env.NODE_ENV
  };

  try {
    const s = await getSettings();
    results.settings = {
      theme: s.theme,
      defaultModel: s.defaultModel,
      activeProfileId: s.activeProfileId,
      hasAccessToken: !!s.linkedinAccessToken,
      hasClientId: !!s.linkedinClientId,
      hasClientSecret: !!s.linkedinClientSecret,
      linkedinClientId: s.linkedinClientId ? `${s.linkedinClientId.slice(0, 4)}...` : null
    };
  } catch (e) { results.settingsError = formatError(e); }

  try {
    const profiles = await getProfiles();
    results.profileCount = profiles.length;
    results.firstProfileId = profiles[0]?.id;
  } catch (e) { results.profilesError = formatError(e); }

  try {
    const { pool } = await import('./db.js');
    const { rows } = await pool.query('SELECT NOW() as time, current_database() as db');
    results.dbTime = rows[0]?.time;
    results.dbName = rows[0]?.db;
    
    const { rows: pr } = await pool.query('SELECT COUNT(*) as c FROM profiles');
    const { rows: sr } = await pool.query('SELECT COUNT(*) as c FROM settings');
    results.profileRowsInDB = parseInt(pr[0]?.c, 10);
    results.settingsRowsInDB = parseInt(sr[0]?.c, 10);
  } catch (e) { results.dbError = formatError(e); }

  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __fn = fileURLToPath(import.meta.url);
    const __dn = path.default.dirname(__fn);
    const dbJsonPath = path.default.join(__dn, '../server/db.json');
    const dbJsonPath2 = path.default.join(__dn, 'db.json');
    results.dbJsonPath1Exists = fs.default.existsSync(dbJsonPath);
    results.dbJsonPath2Exists = fs.default.existsSync(dbJsonPath2);
    results.dirname = __dn;
  } catch (e) { results.fsError = formatError(e); }

  res.json(results);
});

// ── SETTINGS ─────────────────────────────────────────────────────────────────
const envSettings = () => ({
  theme: 'dark',
  defaultModel: process.env.GROQ_DEFAULT_MODEL || 'llama-3.3-70b-versatile',
  ollamaUrl: 'http://localhost:11434',
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || '',
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
});

app.get('/api/settings', async (req, res) => {
  try {
    const s = await getSettings();
    // Always overlay env vars on top in case DB has stale/empty values
    res.json({
      ...s,
      linkedinClientId: process.env.LINKEDIN_CLIENT_ID || s.linkedinClientId || '',
      linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || s.linkedinClientSecret || '',
    });
  } catch (err) {
    console.error('[API GET /api/settings Error]:', err.message);
    // DB failed — return env vars so LinkedIn credentials still show
    res.json(envSettings());
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    let current = {};
    try { current = await getSettings(); } catch { current = envSettings(); }
    const updated = { ...current, ...req.body };
    try { await saveSettings(updated); } catch (dbErr) {
      console.warn('[POST /api/settings] DB save failed, returning in-memory:', dbErr.message);
    }
    res.json({
      ...updated,
      linkedinClientId: process.env.LINKEDIN_CLIENT_ID || updated.linkedinClientId || '',
      linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || updated.linkedinClientSecret || '',
    });
  } catch (err) {
    console.error('[API POST /api/settings Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PROFILES ──────────────────────────────────────────────────────────────────
app.get('/api/profiles', async (req, res) => {
  try {
    const list = await getProfiles();
    res.json(Array.isArray(list) ? list : []);
  } catch (err) {
    console.error('[API GET /api/profiles Error]:', err.message);
    res.json([]);
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const profile = req.body;
    if (!profile.id) { profile.id = 'profile-' + Date.now(); profile.createdAt = Date.now(); }
    profile.updatedAt = Date.now();
    res.json(await saveProfile(profile));
  } catch (err) {
    console.error('[API POST /api/profiles Error]:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── DRAFTS ────────────────────────────────────────────────────────────────────
app.get('/api/drafts', async (req, res) => {
  try {
    const list = await getDrafts();
    res.json(Array.isArray(list) ? list : []);
  } catch (err) {
    console.error('[API GET /api/drafts Error]:', err.message);
    res.json([]);
  }
});

app.post('/api/drafts', async (req, res) => {
  try {
    const draft = req.body;
    if (!draft.id) { draft.id = 'draft-' + Date.now(); draft.createdAt = Date.now(); }
    draft.updatedAt = Date.now();
    res.json(await saveDraft(draft));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/drafts/:id', async (req, res) => {
  try { await deleteDraft(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LOGS ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  try {
    const list = await getLogs();
    res.json(Array.isArray(list) ? list : []);
  } catch (err) {
    console.error('[API GET /api/logs Error]:', err.message);
    res.json([]);
  }
});

app.post('/api/logs', async (req, res) => {
  try {
    const log = req.body;
    if (!log.id) { log.id = 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); log.createdAt = Date.now(); }
    log.updatedAt = Date.now();
    res.json(await saveLog(log));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logs/bulk', async (req, res) => {
  try {
    const { logs, drafts } = req.body;
    if (Array.isArray(drafts)) {
      for (const d of drafts) { d.updatedAt = Date.now(); await saveDraft(d); }
    }
    if (Array.isArray(logs)) {
      for (const log of logs) {
        if (!log.id) { log.id = 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); log.createdAt = Date.now(); }
        log.updatedAt = Date.now();
        await saveLog(log);
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GROQ PROXY ────────────────────────────────────────────────────────────────
app.post('/api/ollama/generate', async (req, res) => {
  try {
    const { prompt, system, model } = req.body;
    const result = await callGroq({ model, prompt, system });
    res.json({ response: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VIDEO UPLOAD PROXY ─────────────────────────────────────────────────────────
app.post('/api/linkedin/init-video-upload', async (req, res) => {
  try {
    const settings = await getSettings();
    const { linkedinAccessToken: accessToken, linkedinMemberUrn: authorUrn } = settings;
    if (!accessToken || !authorUrn) return res.status(401).json({ error: 'LinkedIn not authenticated' });

    const { fileSize } = req.body;

    const response = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601'
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: authorUrn,
          fileSizeBytes: fileSize,
          uploadCaptions: false,
          uploadThumbnail: false
        }
      })
    });

    if (!response.ok) throw new Error(`LinkedIn init failed (${response.status}): ${await response.text()}`);
    const data = await response.json();
    const value = data.value;

    res.json({
      videoUrn: value.video,
      uploadToken: value.uploadToken,
      uploadInstructions: value.uploadInstructions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/linkedin/proxy-video-upload-chunk', async (req, res) => {
  try {
    const { uploadUrl } = req.query;
    if (!uploadUrl) return res.status(400).json({ error: 'Missing uploadUrl query param' });

    const chunkBuffer = req.body;
    if (!chunkBuffer || chunkBuffer.length === 0) return res.status(400).json({ error: 'Empty chunk body' });

    const r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(chunkBuffer.length)
      },
      body: chunkBuffer,
      duplex: 'half'
    });

    if (!r.ok) throw new Error(`LinkedIn chunk upload failed (${r.status}): ${await r.text()}`);

    const etag = r.headers.get('etag') || r.headers.get('ETag') || '';
    res.json({ ETag: etag.replace(/"/g, '') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/linkedin/finalize-video-upload', async (req, res) => {
  try {
    const settings = await getSettings();
    const { linkedinAccessToken: accessToken } = settings;
    if (!accessToken) return res.status(401).json({ error: 'LinkedIn not authenticated' });

    const { videoUrn, uploadToken, uploadedPartIds } = req.body;

    const response = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202601'
      },
      body: JSON.stringify({
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken,
          uploadedPartIds
        }
      })
    });

    if (!response.ok) throw new Error(`LinkedIn finalize failed (${response.status}): ${await response.text()}`);
    res.json({ success: true, videoUrn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LINKEDIN OAUTH ROUTES ─────────────────────────────────────────────────────
const dbShim = {
  get settings() { return this._settings || {}; },
  set settings(v) { this._settings = v; },
  updateSettings: async (newData) => {
    const current = await getSettings();
    const updated = { ...current, ...newData };
    await saveSettings(updated);
    dbShim._settings = updated;
  }
};

(async () => {
  try {
    dbShim._settings = await getSettings();
  } catch (err) {
    console.warn('[Server] Notice: Database pre-fetch pending DATABASE_URL connection:', err.message);
  }
})();

const saveDbShim = async () => {
  await saveSettings(dbShim._settings);
  dbShim._settings = await getSettings();
};

setupLinkedInRoutes(app, dbShim, dbShim, saveDbShim);

// ── ARC LIBRARY & GUARDRAILS ──────────────────────────────────────────────────

// Puesto en false de manera definitiva para producción estable
const FORCE_TEST_VIOLATION = false;

const BANNED_PHRASES = [
  'is a nightmare',
  'is the enemy of',
  'is often criticized',
  'is a major pain point',
  'plagues many of us',
  'plagues us',
  "there's a better way",
  'there is a better way',
  'the key is',
  'the challenge is',
  "that's when the magic happens",
  'data-driven culture',
  "it's exciting to see",
  'the future is all about',
  'game-changer',
  'game changer',
  'changed the game',
  'changes the game',
  'change the game',
  'a whole new ballgame',
  'seamless',
  'seamlessly'
];

function findBannedPhrase(text) {
  const lower = (text || '').toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

function firstSentenceIsQuestion(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  const firstSentence = match ? match[0] : trimmed;
  return firstSentence.trim().endsWith('?');
}

function questionMarkCount(text) {
  return ((text || '').match(/\?/g) || []).length;
}

const ARCS = [
  {
    id: 'contrarian',
    label: 'Contrarian Take',
    system: `You are a professional LinkedIn ghostwriter. Write a post using the CONTRARIAN TAKE structure:
1. State a belief most people in this field hold.
2. Explain why it's wrong or incomplete.
3. State what's actually true.
4. Close with the implication — what this means for how people should think or act.

Rules:
- NEVER mention years of experience, industry names, job titles, or company types.
- BANNED WORDS/PHRASES (do not use any of these, or close variants): ${BANNED_PHRASES.join(', ')}.
- Do NOT open by describing a problem as painful, broken, or an enemy. Open with the belief you're challenging instead.
- Short paragraphs (1-3 lines). Conversational. Direct. No corporate speak. No emojis. No markdown.`,
    buildPrompt: ({ topic, pillar, profile }) => `Write a LinkedIn post on this topic: "${topic}"

Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Tone: ${profile.tone || 'professional, candid, direct'}
Target audience: ${profile.audience || 'professionals'}

Use the contrarian structure: open by stating the common belief on this topic, then explain why that belief is actually wrong or incomplete, then state what's actually true, then close with the implication.`
  },
  {
    id: 'scene',
    label: 'Specific Moment / Scene',
    system: `You are a professional LinkedIn ghostwriter. Write a post using the SPECIFIC MOMENT structure:
1. Open with one concrete, small scene — a specific moment, not an abstract industry statement.
2. Describe the realization that moment triggered.
3. Connect it to the broader point.
4. Close.

Rules:
- NEVER mention years of experience, industry names, job titles, or company types.
- BANNED WORDS/PHRASES (do not use any of these, or close variants): ${BANNED_PHRASES.join(', ')}.
- Do NOT open with an abstract category statement like "X is broken" or "X is hard." Open with a scene instead.
- Do NOT pivot the middle of the post into naming a specific tool as the solution. Stay focused on the realization and the broader point, not a product pitch.
- Short paragraphs (1-3 lines). Conversational. Direct. No corporate speak. No emojis. No markdown.`,
    buildPrompt: ({ topic, pillar, profile }) => `Write a LinkedIn post on this topic: "${topic}"

Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Tone: ${profile.tone || 'professional, candid, direct'}
Target audience: ${profile.audience || 'professionals'}

Open with a specific, concrete moment — a scene, not an abstract statement — then build outward from that scene to the broader point. Do not name a specific product as the fix.`
  },
  {
    id: 'question',
    label: 'Direct Question',
    system: `You are a professional LinkedIn ghostwriter. Write a post using the DIRECT QUESTION structure. This structure REQUIRES that the very first sentence of the post is a question mark-ending question directed at the reader ("you").

Structure:
1. First sentence: a real, sharp question aimed directly at the reader, ending in "?"
2. Explain why most common answers to that question are wrong or incomplete.
3. Give the better way to think about it.
4. Close.

Rules:
- NEVER mention years of experience, industry names, job titles, or company types.
- BANNED WORDS/PHRASES (do not use any of these, or close variants): ${BANNED_PHRASES.join(', ')}.
- HARD RULE: the post must contain EXACTLY ONE question mark in the entire post, and it must be at the end of the first sentence.
- Short paragraphs (1-3 lines). Conversational. Direct. No corporate speak. No emojis. No markdown.`,
    buildPrompt: ({ topic, pillar, profile }) => `Write a LinkedIn post on this topic: "${topic}"

Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Tone: ${profile.tone || 'professional, candid, direct'}
Target audience: ${profile.audience || 'professionals'}

Your first sentence MUST be a direct question to the reader ending with a "?". No other questions anywhere else.`
  },
  {
    id: 'before_after',
    label: 'Before/After Comparison',
    system: `You are a professional LinkedIn ghostwriter. Write a post using the BEFORE/AFTER structure:
1. Describe, tersely, how something used to be done.
2. Cut sharply to how it's done now — no transition phrase needed, just contrast.
3. State the implication of that shift.
4. Close.

Rules:
- NEVER mention years of experience, industry names, job titles, or company types.
- BANNED WORDS/PHRASES: ${BANNED_PHRASES.join(', ')}.
- Short paragraphs (1-3 lines). Conversational. Direct. No corporate speak. No emojis. No markdown.`,
    buildPrompt: ({ topic, pillar, profile }) => {
      if (FORCE_TEST_VIOLATION) {
        return `Write a LinkedIn post on this topic: "${topic}"
Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Tone: ${profile.tone || 'professional, candid, direct'}
Target audience: ${profile.audience || 'professionals'}
TEST MODE: End by explicitly calling this shift a "game-changer" — use that exact phrase somewhere.`;
      }
      return `Write a LinkedIn post on this topic: "${topic}"
Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Tone: ${profile.tone || 'professional, candid, direct'}
Target audience: ${profile.audience || 'professionals'}
Describe briefly how this used to be handled, then contrast it with today. Do NOT use generic superlatives like game-changer.`;
    }
  },
  {
    id: 'single_claim',
    label: 'Single Strong Claim',
    system: `You are a professional LinkedIn ghostwriter. Write a post using the SINGLE STRONG CLAIM structure:
1. Open with one bold, declarative sentence without hedging words like "I think".
2. Spend the rest of the post defending that claim with reasoning.
3. Add one caveat or nuance.
4. Close.

Rules:
- NEVER mention years of experience, industry names, job titles, or company types.
- BANNED WORDS/PHRASES: ${BANNED_PHRASES.join(', ')}.
- Short paragraphs (1-3 lines). Conversational. Direct. No corporate speak. No emojis. No markdown.`,
    buildPrompt: ({ topic, pillar, profile }) => `Write a LinkedIn post on this topic: "${topic}"
Content pillar: ${pillar || profile.contentPillars?.[0] || 'Professional Growth'}
Open with one bold, flat claim about this topic (no hedging).`
  }
];

function pickRandomArc() {
  if (FORCE_TEST_VIOLATION) {
    const found = ARCS.find(a => a.id === 'before_after');
    if (found) return found;
  }
  const index = Math.floor(Math.random() * ARCS.length);
  return ARCS[index];
}

function validateAgainstArc(text, arc) {
  if (!arc) return { ok: true };
  const banned = findBannedPhrase(text);
  if (banned) {
    return { ok: false, reason: `Banned phrase detected: "${banned}"` };
  }

  if (arc.id === 'question') {
    if (!firstSentenceIsQuestion(text)) {
      return { ok: false, reason: 'First sentence does not end in "?"' };
    }
    if (questionMarkCount(text) !== 1) {
      return { ok: false, reason: `Expected exactly 1 question mark, found ${questionMarkCount(text)}` };
    }
  }

  return { ok: true };
}

async function generateWithArcGuardrails({ model, topic, pillar, profile, maxAttempts = 2 }) {
  const arc = pickRandomArc();
  let lastReason = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = arc.buildPrompt({ topic, pillar, profile });
    const raw = await callGroq({ model, prompt: userPrompt, system: arc.system });
    const cleaned = stripEmojis(raw.trim());

    const result = validateAgainstArc(cleaned, arc);
    if (result.ok) {
      console.log(`[Arc Guardrail] ✅ Attempt ${attempt}/${maxAttempts} for arc '${arc.id}' PASSED validation.`);
      return { content: cleaned, arcId: arc.id, arcLabel: arc.label, attempts: attempt };
    }

    lastReason = result.reason;
    console.warn(`[Arc Guardrail] ❌ Attempt ${attempt}/${maxAttempts} for arc '${arc.id}' FAILED: ${lastReason}`);
    
    if (attempt < maxAttempts) {
      console.log(`[Arc Guardrail] ⏳ Pausando 22 segundos para reestablecer ventana TPM de Groq...`);
      await delay(22000); 
      console.log(`[Arc Guardrail] 🔄 Regenerating (attempt ${attempt + 1}/${maxAttempts})...`);
    }
  }

  console.error(`[Arc Guardrail] Arc '${arc.id}' failed validation after ${maxAttempts} attempts. Last reason: ${lastReason}`);
  
  console.log(`[Arc Guardrail] ⏳ Pausa final de 15 segundos antes de generar fallback por Rate Limit...`);
  await delay(15000);

  const fallbackPrompt = arc.buildPrompt({ topic, pillar, profile });
  const fallbackRaw = await callGroq({ model, prompt: fallbackPrompt, system: arc.system });
  const fallbackCleaned = stripEmojis(fallbackRaw.trim());
  return {
    content: fallbackCleaned,
    arcId: arc.id,
    arcLabel: arc.label,
    attempts: maxAttempts + 1,
    guardrailFailed: true,
    guardrailFailureReason: lastReason
  };
}

// ── AUTOPILOT PIPELINE ────────────────────────────────────────────────────────
app.post('/api/autopilot', async (req, res) => {
  const { topic, pillar, model, inputMode, postType } = req.body;
  const settings = await getSettings();
  const profiles = await getProfiles();
  const activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];

  if (!activeProfile) return res.status(400).json({ error: 'Please set up a brand profile first.' });

  const isPersonal = postType === 'personal';

  try {
    let mainDraft, arcMeta = null;

    if (isPersonal) {
      const mainSystem = 'You are a master storyteller. Write authentic, human-first LinkedIn content. No tech jargon unless essential. Lead with emotion. Short paragraphs. Universal truth. No emojis. End with an open question.';
      const mainSystemPrompt = `Write a deeply personal, human LinkedIn story.\nTopic: ${topic}\nWriter: ${activeProfile.name || 'the author'}, ${activeProfile.currentTitle}\nInput Mode: ${inputMode}\nTone: raw, honest, conversational.`;
      mainDraft = stripEmojis((await callGroq({ model, prompt: mainSystemPrompt, system: mainSystem })).trim());
    } else {
      const result = await generateWithArcGuardrails({ model, topic, pillar, profile: activeProfile });
      mainDraft = result.content;
      arcMeta = {
        arcId: result.arcId,
        arcLabel: result.arcLabel,
        attempts: result.attempts,
        guardrailFailed: !!result.guardrailFailed,
        guardrailFailureReason: result.guardrailFailureReason || null
      };
      console.log(`[Autopilot] Arc selected: ${result.arcLabel} (${result.attempts} attempt(s))`);
    }

    console.log(`[Autopilot] ⏳ Esperando 20 segundos antes de generar variantes estéticas...`);
    await delay(20000);

    const styles = ['more-human', 'shorter', 'candid'];
    const variants = [];
    for (const style of styles) {
      const r = await callGroq({
        model,
        prompt: `Rewrite this LinkedIn post in a '${style}' style. Keep the core message. No emojis. Do NOT add years of experience, industry names, or career background. Do NOT use any of these phrases or close variants: ${BANNED_PHRASES.join(', ')}.\nPost:\n${mainDraft}`,
        system: 'You are a master copywriter. Output only the rewritten post. No emojis. No career history openers. No banned hype phrases.'
      });
      const cleanedVariant = stripEmojis(r.trim());
      const variantBanned = findBannedPhrase(cleanedVariant);
      if (variantBanned) {
        console.warn(`[Autopilot] Variant '${style}' contained banned phrase "${variantBanned}" — using main draft as fallback for this variant.`);
        variants.push({ style, content: mainDraft });
      } else {
        variants.push({ style, content: cleanedVariant });
      }
      await delay(5000);
    }

    console.log(`[Autopilot] ⏳ Esperando 15 segundos antes de comenzar la evaluación y puntajes...`);
    await delay(15000);

    const allCandidates = [{ label: 'Main draft', content: mainDraft }, ...variants.map(v => ({ label: v.style, content: v.content }))];
    const scoredCandidates = [];
    for (const cand of allCandidates) {
      try {
        const scoreResp = await callGroq({
          model,
          prompt: `Score this LinkedIn post 0-10 on hook, clarity, relevance, cta, authenticity. Return ONLY valid JSON:\n{"scores":{"hook":8,"clarity":9,"relevance":7,"cta":6,"authenticity":9},"feedback":["feedback 1"]}\n\nPost:\n${cand.content}`,
          system: 'You are a LinkedIn content evaluator. Respond ONLY with raw JSON.'
        });
        const parsed = JSON.parse(scoreResp.replace(/```json|```/gi, '').trim());
        const total = Object.values(parsed.scores).reduce((a, b) => a + b, 0) / Object.keys(parsed.scores).length;
        scoredCandidates.push({ ...cand, score: { scores: parsed.scores, totalScore: Math.round(total * 10) / 10, feedback: parsed.feedback || [] } });
      } catch {
        scoredCandidates.push({ ...cand, score: { scores: { hook:7,clarity:7,relevance:7,cta:7,authenticity:7 }, totalScore: 7.0, feedback: [] } });
      }
      await delay(4000);
    }

    const winner = scoredCandidates.sort((a, b) => b.score.totalScore - a.score.totalScore)[0];
    winner.content = stripEmojis(winner.content);

    console.log(`[Autopilot] ⏳ Esperando 10 segundos antes de generar hashtags finales...`);
    await delay(10000);

    const hashtagInstruction = isPersonal
      ? 'Generate 3 to 5 inspirational hashtags (e.g. #Resilience, #Mindset). Avoid tech hashtags.'
      : 'Generate 3 to 5 professional hashtags (e.g. #DataQuality, #MicrosoftFabric).';
    let hashtags = [];
    try {
      const tagResp = await callGroq({
        model,
        prompt: `${hashtagInstruction} Return ONLY a JSON array of strings.\nPost:\n${winner.content}`,
        system: 'Respond ONLY with a JSON array of strings.'
      });
      hashtags = JSON.parse(tagResp.replace(/```json|```/gi, '').trim());
    } catch {
      hashtags = isPersonal ? ['#Resilience', '#Mindset', '#Leadership'] : ['#ProfessionalBrand', '#CareerGrowth'];
    }

    const finalContent = winner.content + '\n\n' + hashtags.join(' ');

    const draftId = 'draft-' + Date.now();
    const newDraft = {
      id: draftId, prompt: topic, content: finalContent,
      pillar: pillar || activeProfile.contentPillars[0], model,
      arc: arcMeta,
      scoringResult: { id: 'score-' + Date.now(), draftId, scores: winner.score.scores, totalScore: winner.score.totalScore, feedback: winner.score.feedback, model, createdAt: Date.now() },
      variants: variants.map(v => stripEmojis(v.content)),
      hashtags, status: 'ready', createdAt: Date.now(), updatedAt: Date.now()
    };

    await saveDraft(newDraft);
    res.json({ success: true, selectedDraft: newDraft, allCandidates: scoredCandidates });
  } catch (err) {
    console.error('Autopilot Error:', err);
    res.status(500).json({ error: `Autopilot failed: ${err.message}` });
  }
});

// ── VIDEO PROCESSING POLLER ───────────────────────────────────────────────────
async function waitForVideoAvailable(videoUrn, accessToken, { intervalMs = 5000, timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const encoded = encodeURIComponent(videoUrn);

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`https://api.linkedin.com/rest/videos/${encoded}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601'
        }
      });
      const data = await res.json().catch(() => ({}));
      const status = data?.status;
      console.log(`[Video Poll] ${videoUrn} → ${status}`);

      if (status === 'AVAILABLE') return { ok: true };
      if (status === 'PROCESSING_FAILED') return { ok: false, reason: 'PROCESSING_FAILED' };
    } catch (err) {
      console.warn('[Video Poll] fetch error (will retry):', err.message);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  return { ok: false, reason: 'TIMEOUT' };
}

// ── BACKGROUND SCHEDULER ──────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const now = Date.now();
    
    const readyDrafts = await getReadyDrafts();
    const due = readyDrafts.filter(d => d.scheduledAt && d.scheduledAt <= now);
    if (!due.length) return;

    console.log(`[Scheduler] Found ${due.length} post(s) ready to publish.`);
    const settings = await getSettings();
    const { linkedinAccessToken: accessToken, linkedinMemberUrn: authorUrn } = settings;

    for (const draft of due) {
      if (!accessToken || !authorUrn) {
        draft.status = 'ready-manual'; draft.updatedAt = Date.now();
        await saveDraft(draft); continue;
      }

      try {
        if (draft.videoUrn) {
          console.log(`[Scheduler] Video post detected for '${draft.id}', polling LinkedIn for AVAILABLE status...`);
          const poll = await waitForVideoAvailable(draft.videoUrn, accessToken);
          if (!poll.ok) {
            throw new Error(
              poll.reason === 'PROCESSING_FAILED'
                ? `LinkedIn rejected the video (PROCESSING_FAILED). Check the video format/codec and re-upload.`
                : `Video not ready after 120s (TIMEOUT). LinkedIn may still be processing — try rescheduling.`
            );
          }
          console.log(`[Scheduler] Video AVAILABLE. Proceeding to publish '${draft.id}'.`);
        }

        const postBody = {
          author: authorUrn,
          commentary: draft.content,
          visibility: 'PUBLIC',
          distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
          lifecycleState: 'PUBLISHED',
          ...(draft.videoUrn ? { content: { media: { id: draft.videoUrn } } } : {})
        };

        const response = await fetch('https://api.linkedin.com/rest/posts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601'
          },
          body: JSON.stringify(postBody)
        });

        if (!response.ok) throw new Error(`LinkedIn API ${response.status}: ${await response.text()}`);

        const postId = response.headers.get('x-restli-id') || `urn:li:share:${Date.now()}`;
        draft.status = 'posted'; draft.postedAt = Date.now(); draft.linkedinPostId = postId; draft.updatedAt = Date.now();
        await saveDraft(draft);

        const log = {
          id: 'log-' + Date.now(), sourceDraftId: draft.id,
          postTitle: draft.prompt.slice(0, 40) + '...',
          postedAt: Date.now(), pillar: draft.pillar, format: 'insight',
          impressions: 0, reactions: 0, comments: 0, reposts: 0, profileViews: 0,
          notes: `Auto-published. URN: ${postId}`,
          createdAt: Date.now(), updatedAt: Date.now()
        };
        await saveLog(log);
        console.log(`[Scheduler] Published '${draft.id}' → ${postId}`);

      } catch (err) {
        draft.status = 'error'; draft.errorMessage = err.message; draft.updatedAt = Date.now();
        await saveDraft(draft);
        console.error(`[Scheduler] Failed '${draft.id}':`, err.message);
      }
    }
  } catch (err) { console.error('[Scheduler] Error:', err.message); }
}, 30000);

// ── STATIC FRONTEND ───────────────────────────────────────────────────────────
import { existsSync } from 'fs';

const distPath = path.resolve(process.cwd(), 'dist');

if (existsSync(distPath)) {
  console.log(`[Server] Directorio de frontend estático detectado en: ${distPath}`);
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint de API no encontrado' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn(`[Server] Advertencia: No se encontró la carpeta 'dist' en ${distPath}.`);
}

// ── STARTUP ───────────────────────────────────────────────────────────────────
// Run initDB FIRST, then start listening — prevents race condition where
// GET /api/profiles is called before seeding completes, returning empty arrays.
initDB()
  .then(() => {
    console.log('[PostgreSQL] Database ready — starting HTTP server...');
    app.listen(PORT, () => {
      console.log(`[Server] Poster.ai cloud running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[PostgreSQL] Database initialization failed:', err.message);
    // Start server anyway so Railway health checks pass, but DB may be unavailable
    app.listen(PORT, () => {
      console.log(`[Server] Poster.ai cloud running on port ${PORT} (DB unavailable)`);
    });
  });