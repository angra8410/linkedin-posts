import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { setupLinkedInRoutes } from './linkedin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripEmojis(text) {
  if (!text) return '';
  return text.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
}

// ── ENV VALIDATION ──────────────────────────────────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'GROQ_API_KEY'];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key]) {
    console.error(`[Server] Missing required env var: ${key}`);
    process.exit(1);
  }
});

// ── SUPABASE CLIENT ─────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── DB HELPERS ──────────────────────────────────────────────────────────────
async function getSettings() {
  const { data } = await supabase.from('settings').select('data').eq('id', 'app').single();
  const base = data?.data || {};
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

async function saveSettings(data) {
  await supabase.from('settings').upsert({ id: 'app', data, updated_at: new Date().toISOString() });
}

async function getProfiles() {
  const { data } = await supabase.from('profiles').select('data').order('updated_at', { ascending: false });
  return (data || []).map(r => r.data);
}

async function saveProfile(profile) {
  await supabase.from('profiles').upsert({ id: profile.id, data: profile, updated_at: new Date().toISOString() });
  return profile;
}

async function getDrafts() {
  const { data } = await supabase.from('drafts').select('data').order('updated_at', { ascending: false });
  return (data || []).map(r => r.data);
}

async function saveDraft(draft) {
  await supabase.from('drafts').upsert({ id: draft.id, data: draft, updated_at: new Date().toISOString() });
  return draft;
}

async function deleteDraft(id) {
  await supabase.from('drafts').delete().eq('id', id);
}

async function getLogs() {
  const { data } = await supabase.from('logs').select('data').order('updated_at', { ascending: false });
  return (data || []).map(r => r.data);
}

async function saveLog(log) {
  await supabase.from('logs').upsert({ id: log.id, data: log, updated_at: new Date().toISOString() });
  return log;
}

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

// Raw binary parser for video chunk uploads — must come BEFORE the JSON body parser
// so Express doesn't try to parse octet-stream as JSON
app.use('/api/linkedin/proxy-video-upload-chunk', express.raw({ type: 'application/octet-stream', limit: '10mb' }));

// JSON parser for everything else (reduced from 100mb — no more base64 video bodies)
app.use(bodyParser.json({ limit: '10mb' }));

// ── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try { res.json(await getSettings()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    const current = await getSettings();
    const updated = { ...current, ...req.body };
    await saveSettings(updated);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PROFILES ──────────────────────────────────────────────────────────────────
app.get('/api/profiles', async (req, res) => {
  try { res.json(await getProfiles()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const profile = req.body;
    if (!profile.id) { profile.id = 'profile-' + Date.now(); profile.createdAt = Date.now(); }
    profile.updatedAt = Date.now();
    const settings = await getSettings();
    if (!settings.activeProfileId) {
      await saveSettings({ ...settings, activeProfileId: profile.id });
    }
    res.json(await saveProfile(profile));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DRAFTS ────────────────────────────────────────────────────────────────────
app.get('/api/drafts', async (req, res) => {
  try { res.json(await getDrafts()); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
  try { res.json(await getLogs()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logs', async (req, res) => {
  try {
    const log = req.body;
    if (!log.id) { log.id = 'log-' + Date.now(); log.createdAt = Date.now(); }
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
        if (!log.id) { log.id = 'log-' + Date.now(); log.createdAt = Date.now(); }
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

// ── VIDEO UPLOAD PROXY (3 routes replace the old single base64 route) ─────────

// 1. Init — ask LinkedIn to create the upload session
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
      uploadInstructions: value.uploadInstructions // array of { uploadUrl, firstByte, lastByte }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Chunk upload — receives raw binary from the browser, forwards to LinkedIn's uploadUrl
// express.raw() is applied to this route above (before bodyParser.json)
app.post('/api/linkedin/proxy-video-upload-chunk', async (req, res) => {
  try {
    const { uploadUrl } = req.query;
    if (!uploadUrl) return res.status(400).json({ error: 'Missing uploadUrl query param' });

    const chunkBuffer = req.body; // raw Buffer from express.raw()
    if (!chunkBuffer || chunkBuffer.length === 0) return res.status(400).json({ error: 'Empty chunk body' });

    const r = await fetch(decodeURIComponent(uploadUrl), {
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

// 3. Finalize — tells LinkedIn all chunks are done
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

(async () => { dbShim._settings = await getSettings(); })();

const saveDbShim = async () => {
  await saveSettings(dbShim._settings);
  dbShim._settings = await getSettings();
};

setupLinkedInRoutes(app, dbShim, dbShim, saveDbShim);

// ── AUTOPILOT PIPELINE ────────────────────────────────────────────────────────
app.post('/api/autopilot', async (req, res) => {
  const { topic, pillar, model, inputMode, postType } = req.body;
  const settings = await getSettings();
  const profiles = await getProfiles();
  const activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];

  if (!activeProfile) return res.status(400).json({ error: 'Please set up a brand profile first.' });

  const isPersonal = postType === 'personal';

  try {
    // Stage 1: Main draft
    let mainPrompt, mainSystem;
    if (isPersonal) {
      mainSystem = 'You are a master storyteller. Write authentic, human-first LinkedIn content. No tech jargon unless essential. Lead with emotion. Short paragraphs. Universal truth. No emojis. End with an open question.';
      mainPrompt = `Write a deeply personal, human LinkedIn story.\nTopic: ${topic}\nWriter: ${activeProfile.name || 'the author'}, ${activeProfile.currentTitle}\nInput Mode: ${inputMode}\nTone: raw, honest, conversational.`;
    } else {
      mainSystem = 'You are a professional LinkedIn growth assistant. Output only the post commentary. No markdown, no preamble. No emojis.';
      mainPrompt = `Generate a high-converting LinkedIn post.\nTopic: ${topic}\nPillar: ${pillar || activeProfile.contentPillars[0]}\nProfile Tone: ${activeProfile.tone}\nExperience: ${activeProfile.yearsExperience} years in ${activeProfile.industries.join(', ')}\nSkills: ${activeProfile.skills.join(', ')}\nTarget Audience: ${activeProfile.audience}\nInput Mode: ${inputMode}\n\nSound professional, candid, direct. No emojis.`;
    }

    const mainDraft = stripEmojis((await callGroq({ model, prompt: mainPrompt, system: mainSystem })).trim());

    // Stage 2: Variants
    const styles = ['more-human', 'shorter', 'candid'];
    const variants = [];
    for (const style of styles) {
      const r = await callGroq({
        model,
        prompt: `Rewrite this LinkedIn post in a '${style}' style. Keep the core message. No emojis.\nPost:\n${mainDraft}`,
        system: 'You are a master copywriter. Output only the rewritten post. No emojis.'
      });
      variants.push({ style, content: stripEmojis(r.trim()) });
    }

    // Stage 3: Score & pick winner
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
    }

    const winner = scoredCandidates.sort((a, b) => b.score.totalScore - a.score.totalScore)[0];
    winner.content = stripEmojis(winner.content);

    // Stage 4: Hashtags
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

    // Stage 5: Save draft
    const draftId = 'draft-' + Date.now();
    const newDraft = {
      id: draftId, prompt: topic, content: finalContent,
      pillar: pillar || activeProfile.contentPillars[0], model,
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
    const drafts = await getDrafts();
    const due = drafts.filter(d => d.status === 'ready' && d.scheduledAt && d.scheduledAt <= now);
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

        const response = await fetch('https://api.linkedin.com/v2/posts', {
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

app.listen(PORT, () => console.log(`[Server] Poster.ai cloud running on port ${PORT}`));