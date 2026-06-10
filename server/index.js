import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupLinkedInRoutes } from './linkedin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'db.json');

function stripEmojis(text) {
  if (!text) return '';
  return text.replace(/[\u2600-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g, '').trim();
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.raw({ type: 'application/octet-stream', limit: '200mb' }));

// --- DB READ/WRITE HELPER ---
let db = {
  profiles: [],
  drafts: [],
  performanceLogs: [],
  settings: {},
  savedPrompts: []
};

function readDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      db = JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading JSON database:', err);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing to JSON database:', err);
  }
}

// Initial DB load
readDb();

// --- REST API ENDPOINTS ---

// 1. Settings
app.get('/api/settings', (req, res) => {
  res.json(db.settings);
});

app.post('/api/settings', (req, res) => {
  db.settings = { ...db.settings, ...req.body };
  saveDb();
  res.json(db.settings);
});

// 2. Brand Profiles
app.get('/api/profiles', (req, res) => {
  res.json(db.profiles);
});

app.post('/api/profiles', (req, res) => {
  const profile = req.body;
  if (!profile.id) {
    profile.id = 'profile-' + Date.now();
    profile.createdAt = Date.now();
  }
  profile.updatedAt = Date.now();

  const idx = db.profiles.findIndex(p => p.id === profile.id);
  if (idx > -1) {
    db.profiles[idx] = profile;
  } else {
    db.profiles.push(profile);
  }
  
  // Update activeProfileId if this is the first profile
  if (!db.settings.activeProfileId) {
    db.settings.activeProfileId = profile.id;
  }
  
  saveDb();
  res.json(profile);
});

// 3. Drafts
app.get('/api/drafts', (req, res) => {
  res.json(db.drafts);
});

app.post('/api/drafts', (req, res) => {
  const draft = req.body;
  if (!draft.id) {
    draft.id = 'draft-' + Date.now();
    draft.createdAt = Date.now();
  }
  draft.updatedAt = Date.now();

  const idx = db.drafts.findIndex(d => d.id === draft.id);
  if (idx > -1) {
    db.drafts[idx] = draft;
  } else {
    db.drafts.push(draft);
  }
  saveDb();
  res.json(draft);
});

app.delete('/api/drafts/:id', (req, res) => {
  db.drafts = db.drafts.filter(d => d.id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

// 4. Analytics Performance Logs
app.get('/api/logs', (req, res) => {
  res.json(db.performanceLogs);
});

app.post('/api/logs', (req, res) => {
  const log = req.body;
  if (!log.id) {
    log.id = 'log-' + Date.now();
    log.createdAt = Date.now();
  }
  log.updatedAt = Date.now();

  const idx = db.performanceLogs.findIndex(l => l.id === log.id);
  if (idx > -1) {
    db.performanceLogs[idx] = log;
  } else {
    db.performanceLogs.push(log);
  }
  saveDb();
  res.json(log);
});

// 5. Bulk Logs Reconciliation Import
app.post('/api/logs/bulk', (req, res) => {
  const { logs, drafts } = req.body;

  if (Array.isArray(drafts)) {
    drafts.forEach(d => {
      const idx = db.drafts.findIndex(x => x.id === d.id || (d.linkedinPostId && x.linkedinPostId === d.linkedinPostId));
      if (idx > -1) {
        db.drafts[idx] = { ...db.drafts[idx], ...d, updatedAt: Date.now() };
      }
    });
  }

  if (Array.isArray(logs)) {
    logs.forEach(log => {
      if (!log.id) {
        log.id = 'log-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now();
        log.createdAt = Date.now();
      }
      log.updatedAt = Date.now();

      // Find existing log by id or sourceDraftId
      const idx = db.performanceLogs.findIndex(l => 
        l.id === log.id || 
        (log.sourceDraftId && l.sourceDraftId === log.sourceDraftId)
      );

      if (idx > -1) {
        db.performanceLogs[idx] = { ...db.performanceLogs[idx], ...log };
      } else {
        db.performanceLogs.push(log);
      }
    });
  }

  saveDb();
  res.json({ success: true });
});


// --- OLLAMA STREAM PROXY ---
app.post('/api/ollama/generate', async (req, res) => {
  const settings = db.settings;
  const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
  
  try {
    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    if (req.body.stream === false) {
      const data = await response.json();
      return res.json(data);
    }

    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    console.error('Ollama Proxy Error:', err);
    res.status(500).json({ error: `Ollama connection failed at ${ollamaUrl}. Details: ${err.message}` });
  }
});

// Helper: Sync-call to Ollama proxy for backend orchestration
async function callOllamaBackend(payload) {
  const settings = db.settings;
  const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
  
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: false })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama returned status ${response.status}`);
  }
  
  const data = await response.json();
  return data.response;
}

// --- SETUP LINKEDIN OAUTH ROUTES ---

// Video chunked upload proxy — handles multipart LinkedIn video upload server-side
// Receives base64 chunks from browser and forwards each part to LinkedIn
app.post('/api/linkedin/proxy-video-upload', async (req, res) => {
  const { uploadInstructions, videoBase64 } = req.body;
  if (!uploadInstructions || !videoBase64) {
    return res.status(400).json({ error: 'Missing uploadInstructions or videoBase64' });
  }

  try {
    const videoBuffer = Buffer.from(videoBase64, 'base64');
    const totalSize = videoBuffer.length;
    const uploadedPartIds = [];

    // Upload each chunk to its corresponding URL
    for (let i = 0; i < uploadInstructions.length; i++) {
      const instruction = uploadInstructions[i];
      const start = instruction.firstByte;
      const end = Math.min(instruction.lastByte + 1, totalSize);
      const chunk = videoBuffer.slice(start, end);

      const response = await fetch(instruction.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Chunk ${i+1} upload failed (${response.status}): ${errText}`);
      }

      // LinkedIn returns ETag in header for each part
      const etag = response.headers.get('etag') || response.headers.get('ETag') || `part-${i}`;
      uploadedPartIds.push(etag.replace(/"/g, ''));
    }

    res.json({ success: true, uploadedPartIds });
  } catch (err) {
    console.error('Video proxy error:', err);
    res.status(500).json({ error: err.message });
  }
});

setupLinkedInRoutes(app, db, saveDb);

// --- AUTOPILOT PIPELINE ENDPOINT ---
app.post('/api/autopilot', async (req, res) => {
  const { topic, pillar, model, inputMode, postType } = req.body;
  const activeProfile = db.profiles.find(p => p.id === db.settings.activeProfileId) || db.profiles[0];

  if (!activeProfile) {
    return res.status(400).json({ error: 'Please set up a brand profile first.' });
  }

  const isPersonal = postType === 'personal';

  try {
    // Stage 1: Generate Main Draft
    let mainPrompt, mainSystem;

    if (isPersonal) {
      mainSystem = 'You are a master storyteller. Write authentic, human-first LinkedIn content. No tech jargon unless essential. Lead with emotion. Short paragraphs. Universal truth. No emojis. End with an open question.';
      mainPrompt = `Write a deeply personal, human LinkedIn story.\nTopic: ${topic}\nWriter: ${activeProfile.name || 'the author'}, ${activeProfile.currentTitle}\nInput Mode: ${inputMode} (if source, adapt the emotional truth; if topic, write a personal narrative)\nTone: raw, honest, conversational.`;
    } else {
      mainSystem = 'You are a professional LinkedIn growth assistant. Do not include markdown codeblocks, notes, or intros. Just output the post commentary. Do NOT use emojis under any circumstances. Keep the text entirely text-based.';
      mainPrompt = `Generate a high-converting LinkedIn post.\nTopic: ${topic}\nPillar: ${pillar || activeProfile.contentPillars[0]}\nProfile Tone: ${activeProfile.tone}\nExperience: ${activeProfile.yearsExperience} years in ${activeProfile.industries.join(', ')}\nSkills: ${activeProfile.skills.join(', ')}\nTarget Audience: ${activeProfile.audience}\nInput Mode: ${inputMode} (if source, adapt closely; if topic, write creative post)\n\nDo not add generic corporate fluff. Sound professional, candid, and direct.\nDo NOT use emojis under any circumstances.`;
    }


    const mainResponse = await callOllamaBackend({
      model,
      prompt: mainPrompt,
      system: mainSystem
    });
    const mainDraft = stripEmojis(mainResponse.trim());

    // Stage 2: Generate Variants
    const styles = ['more-human', 'shorter', 'candid'];
    const variants = [];
    
    for (const style of styles) {
      const variantPrompt = `Rewrite this LinkedIn post to be specifically in a '${style}' style. Keep the core message but adjust the tone. Do NOT use emojis under any circumstances. Keep the text entirely text-based.
Post:\n${mainDraft}`;

      const varResponse = await callOllamaBackend({
        model,
        prompt: variantPrompt,
        system: "You are a master copywriter rewriting for LinkedIn. Do not include markdown codeblocks or meta-commentary. Do NOT use emojis under any circumstances. Keep the text entirely text-based."
      });
      variants.push({ style, content: stripEmojis(varResponse.trim()) });
    }

    // Stage 3: Score Candidates & Pick Winner
    const allCandidates = [
      { label: 'Main draft', content: mainDraft },
      ...variants.map(v => ({ label: v.style, content: v.content }))
    ];

    const scoredCandidates = [];
    for (const cand of allCandidates) {
      const scorePrompt = `Score the following LinkedIn post from 0 to 10 on these criteria: hook, clarity, relevance, CTA, authenticity. Return ONLY a valid JSON object in this format:
{
  "scores": {
    "hook": 8,
    "clarity": 9,
    "relevance": 7,
    "cta": 6,
    "authenticity": 9
  },
  "feedback": ["feedback 1", "feedback 2"]
}

Post to score:\n${cand.content}`;

      const scoreResponse = await callOllamaBackend({
        model,
        prompt: scorePrompt,
        system: "You are a LinkedIn content evaluator. Respond ONLY with raw JSON."
      });

      try {
        const cleanedJson = scoreResponse.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanedJson);
        const scores = parsed.scores;
        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
        
        scoredCandidates.push({
          ...cand,
          score: {
            scores,
            totalScore: Math.round(totalScore * 10) / 10,
            feedback: parsed.feedback || []
          }
        });
      } catch (err) {
        // Fallback score
        scoredCandidates.push({
          ...cand,
          score: {
            scores: { hook: 7, clarity: 7, relevance: 7, cta: 7, authenticity: 7 },
            totalScore: 7.0,
            feedback: ['Could not parse evaluator output.']
          }
        });
      }
    }

    // Pick winner
    const winner = scoredCandidates.sort((a, b) => b.score.totalScore - a.score.totalScore)[0];
    winner.content = stripEmojis(winner.content);

    // Stage 4: Generate Hashtags for the winner
    const hashtagInstruction = isPersonal
      ? 'Generate 3 to 5 inspirational, human hashtags (e.g. #Resilience, #Mindset, #Leadership). Avoid tech or product hashtags.'
      : 'Generate 3 to 5 highly relevant professional hashtags (e.g. #DataQuality, #AI, #MicrosoftFabric).';
    const hashtagPrompt = `${hashtagInstruction} Return a JSON array of strings.
Post:\n${winner.content}`;
    const hashtagResponse = await callOllamaBackend({
      model,
      prompt: hashtagPrompt,
      system: "You are a social SEO assistant. Respond ONLY with a JSON array of strings."
    });

    let hashtags = [];
    try {
      const cleanedTags = hashtagResponse.replace(/```json|```/gi, '').trim();
      hashtags = JSON.parse(cleanedTags);
    } catch {
      hashtags = isPersonal ? ['#Resilience', '#Mindset', '#Leadership'] : ['#ProfessionalBrand', '#CareerGrowth'];
    }

    // Stage 5: Append Hashtags to Winner
    const finalContent = winner.content + '\n\n' + hashtags.join(' ');

    // Stage 6: Auto-Save Draft
    const draftId = 'draft-' + Date.now();
    const newDraft = {
      id: draftId,
      prompt: topic,
      content: finalContent,
      pillar: pillar || activeProfile.contentPillars[0],
      model,
      scoringResult: {
        id: 'score-' + Date.now(),
        draftId,
        scores: winner.score.scores,
        totalScore: winner.score.totalScore,
        feedback: winner.score.feedback,
        model,
        createdAt: Date.now()
      },
      variants: variants.map(v => stripEmojis(v.content)),
      hashtags,
      status: 'ready', // ready for scheduling or posting
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.drafts.push(newDraft);
    saveDb();

    res.json({
      success: true,
      selectedDraft: newDraft,
      allCandidates: scoredCandidates
    });
  } catch (err) {
    console.error('Autopilot Pipeline Error:', err);
    res.status(500).json({ error: `Autopilot failed. Details: ${err.message}` });
  }
});

// --- BACKGROUND SCHEDULER CROON WORKER ---
// Checks every 30 seconds for scheduled posts that are ready to be published
setInterval(async () => {
  const now = Date.now();
  const scheduledPosts = db.drafts.filter(d => d.status === 'ready' && d.scheduledAt && d.scheduledAt <= now);
  
  if (scheduledPosts.length === 0) return;

  console.log(`[Scheduler] Found ${scheduledPosts.length} post(s) ready to publish.`);
  const accessToken = db.settings.linkedinAccessToken;
  const authorUrn = db.settings.linkedinMemberUrn;

  for (const draft of scheduledPosts) {
    if (!accessToken || !authorUrn) {
      console.warn(`[Scheduler] Cannot publish post '${draft.id}' automatically: LinkedIn credentials not configured. Moving to 'ready-manual'.`);
      draft.status = 'ready-manual';
      draft.updatedAt = Date.now();
      saveDb();
      continue;
    }

    try {
      console.log(`[Scheduler] Posting draft '${draft.id}' to LinkedIn...`);
      const response = await fetch('https://api.linkedin.com/v2/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601'
        },
        body: JSON.stringify({
          author: authorUrn,
          commentary: draft.content,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: []
          },
          lifecycleState: 'PUBLISHED',
          ...(draft.videoUrn ? { content: { media: { id: draft.videoUrn } } } : {})
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LinkedIn API returned status ${response.status}: ${errText}`);
      }

      const responseId = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id');
      const data = await response.json().catch(() => ({}));
      const postId = responseId || data.id || `urn:li:share:${Date.now()}`;

      // Update draft status
      draft.status = 'posted';
      draft.postedAt = Date.now();
      draft.linkedinPostId = postId;
      draft.updatedAt = Date.now();

      // Seed Performance Log for Analytics
      const logId = 'log-' + Date.now();
      const newLog = {
        id: logId,
        sourceDraftId: draft.id,
        postTitle: draft.prompt.slice(0, 40) + '...',
        postedAt: Date.now(),
        pillar: draft.pillar,
        format: draft.content.includes('\n-') || draft.content.includes('\n*') ? 'list' : 'insight',
        impressions: 0,
        reactions: 0,
        comments: 0,
        reposts: 0,
        profileViews: 0,
        notes: `Published automatically. Post ID: ${postId}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      db.performanceLogs.push(newLog);
      saveDb();
      console.log(`[Scheduler] Successfully published post '${draft.id}' (URN: ${postId}) and logged in analytics.`);
    } catch (err) {
      console.error(`[Scheduler] Failed to publish post '${draft.id}':`, err);
      // Mark as error so we don't loop indefinitely on it
      draft.status = 'error';
      draft.errorMessage = err.message;
      draft.updatedAt = Date.now();
      saveDb();
    }
  }
}, 30000);

// --- STATIC ASSETS FRONTEND ROUTING ---
// In production, serve the built frontend assets
if (fs.existsSync(path.join(__dirname, '../dist'))) {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[Server] LinkedIn Auto-Poster running on port ${PORT}`);
});