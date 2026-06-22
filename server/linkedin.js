import fetch from 'node-fetch';

function getSettings(db) {
  // Prioridad absoluta a variables de entorno para evitar condiciones de carrera en la nube
  return {
    ...(db?.settings || {}),
    linkedinClientId: process.env.LINKEDIN_CLIENT_ID || db?.settings?.linkedinClientId,
    linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || db?.settings?.linkedinClientSecret,
  };
}

export function setupLinkedInRoutes(app, db, dbShim, saveDb) {
  // Auxiliar para construir la URL de redirección detectando el protocolo correcto en la nube (HTTPS)
  const getRedirectUri = (req) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');

    if (host.includes('railway.app')) {
      return `https://${host}/api/auth/linkedin/callback`;
    }
    return `${protocol}://${host}/api/auth/linkedin/callback`;
  };

  app.get('/api/auth/linkedin/url', (req, res) => {
    const settings = getSettings(db);
    if (!settings.linkedinClientId) {
      return res.status(400).json({ error: 'Falta LinkedIn Client ID en la configuración.' });
    }

    const redirectUri = getRedirectUri(req);
    const state = Math.random().toString(36).substring(2) + Date.now();

    if (db && db.settings) {
      db.settings.lastOauthState = state;
    }

    const scope = encodeURIComponent('w_member_social openid profile email');
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${settings.linkedinClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;

    res.json({ url: authUrl });
  });

  app.get('/api/auth/linkedin/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(`/?linkedin_error=${encodeURIComponent(error_description || error)}`);
    }

    const settings = getSettings(db);
    const redirectUri = getRedirectUri(req);

    try {
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: settings.linkedinClientId,
          client_secret: settings.linkedinClientSecret
        })
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('[OAuth Error Details]:', tokenData);
        return res.redirect(`/?linkedin_error=${encodeURIComponent(tokenData.error_description || 'Fallo en el intercambio de token')}`);
      }

      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });

      const userData = await userResponse.json();
      const memberUrn = `urn:li:person:${userData.sub}`;

      db.settings.linkedinAccessToken = tokenData.access_token;
      db.settings.linkedinMemberUrn = memberUrn;
      db.settings.linkedinTokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
      await saveDb();

      res.redirect('/?linkedin_status=success');
    } catch (err) {
      console.error('[Callback Exception]:', err);
      res.redirect(`/?linkedin_error=${encodeURIComponent(err.message)}`);
    }
  });

  // Endpoint para publicaciones directas
  app.post('/api/linkedin/post', async (req, res) => {
    const { content, videoUrn } = req.body;
    const settings = getSettings(db);

    const accessToken = settings.linkedinAccessToken;
    const authorUrn = settings.linkedinMemberUrn;

    if (!accessToken || !authorUrn) {
      return res.status(401).json({ error: 'No conectado a LinkedIn o credenciales ausentes.' });
    }

    try {
      const requestBody = {
        author: authorUrn,
        commentary: content,
        visibility: 'PUBLIC',
        lifecycleState: 'PUBLISHED',
        distribution: {
          feedDistribution: 'MAIN_FEED',   
        }
      };

      if (videoUrn) {
        requestBody.content = {
          media: { title: 'Video Post', id: videoUrn }
        };
      }

      const response = await fetch('https://api.linkedin.com/v2/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202601',
          'X-Restli-Protocol-Version': '2.0.0'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error('[Post Error] LinkedIn response:', response.status, JSON.stringify(data));  // ADD THIS
        return res.status(response.status).json({ error: 'Error publicando en LinkedIn', details: data });
      }

      res.json({ success: true, postId: response.headers.get('x-linkedin-id') || 'unknown' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3a. Initialize video upload
  app.post('/api/linkedin/init-video-upload', async (req, res) => {
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;
    const authorUrn = settings.linkedinMemberUrn;

    if (!accessToken || !authorUrn) {
      return res.status(401).json({ error: 'No conectado a LinkedIn o credenciales ausentes.' });
    }

    const { fileSize, fileSizeBytes } = req.body;
    const size = fileSize ?? fileSizeBytes;
    if (!size) return res.status(400).json({ error: 'Missing fileSize.' });

    try {
      const initResponse = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
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
            fileSizeBytes: parseInt(size, 10),
            uploadCaptions: false,
            uploadThumbnail: false
          }
        })
      });

      if (!initResponse.ok) {
        const errText = await initResponse.text();
        throw new Error(`Video init failed (${initResponse.status}): ${errText}`);
      }

      const initData = await initResponse.json();
      const uploadInstructions = initData.value?.uploadInstructions;
      const videoUrn = initData.value?.video;
      const uploadToken = initData.value?.uploadToken;

      if (!uploadInstructions || !videoUrn) {
        throw new Error('LinkedIn did not return upload instructions or video URN.');
      }

      console.log('[Init Video] LinkedIn response value:', JSON.stringify(initData.value));

      res.json({ success: true, uploadInstructions, videoUrn, uploadToken });
    } catch (err) {
      console.error('[Video Init Error]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3b. Proxy individual chunk upload to LinkedIn's signed Ambry URL
  // This avoids CORS issues when uploading directly from the browser.
  app.post('/api/linkedin/proxy-video-upload', async (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const uploadUrl = req.headers['x-upload-url'];
      if (!uploadUrl) return res.status(400).json({ error: 'Missing x-upload-url header.' });

      const body = Buffer.concat(chunks);
      console.log(`[Proxy Upload] Uploading ${body.length} bytes to signed URL...`);

      try {
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body
        });

        const etag = uploadRes.headers.get('etag') || uploadRes.headers.get('ETag') || '';
        console.log(`[Proxy Upload] Done — status ${uploadRes.status}, ETag: ${etag}`);

        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          return res.status(uploadRes.status).json({ error: `Upload failed: ${errText}` });
        }

        res.json({ success: true, etag });
      } catch (err) {
        console.error('[Proxy Upload Error]:', err);
        res.status(500).json({ error: err.message });
      }
    });
  });

  // 3c. Finalize video upload
  app.post('/api/linkedin/finalize-video-upload', async (req, res) => {
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;

    if (!accessToken) {
      return res.status(401).json({ error: 'No conectado a LinkedIn o credenciales ausentes.' });
    }

    const { videoUrn, uploadToken, uploadedPartIds } = req.body;
    if (!videoUrn) return res.status(400).json({ error: 'Missing videoUrn.' });

    try {
      console.log('[Finalize Video] Request body:', JSON.stringify({ videoUrn, uploadToken, uploadedPartIds }));

      // Build finalize request — omit uploadToken entirely if empty/absent
      // (sending uploadToken: "" alongside uploadedPartIds breaks multipart finalize)
      const finalizeUploadRequest = {
        video: videoUrn,
        uploadedPartIds: uploadedPartIds || []
      };
      if (uploadToken) finalizeUploadRequest.uploadToken = uploadToken;

      const finalizeResponse = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601'
        },
        body: JSON.stringify({ finalizeUploadRequest })
      });

      if (!finalizeResponse.ok) {
        const errText = await finalizeResponse.text();
        console.error('[Finalize Video Error]:', finalizeResponse.status, errText);
        throw new Error(`Video finalize failed (${finalizeResponse.status}): ${errText}`);
      }

      console.log('[Finalize Video] Success for:', videoUrn);
      res.json({ success: true, videoUrn });
    } catch (err) {
      console.error('[Video Finalize Error]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3d. Poll video processing status
  app.get('/api/linkedin/video-status/:videoUrn', async (req, res) => {
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;

    if (!accessToken) {
      return res.status(401).json({ error: 'No conectado a LinkedIn.' });
    }

    const videoUrn = decodeURIComponent(req.params.videoUrn);
    const encoded = encodeURIComponent(videoUrn);

    try {
      const statusRes = await fetch(`https://api.linkedin.com/rest/videos/${encoded}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': '202601'
        }
      });

      const data = await statusRes.json().catch(() => ({}));
      console.log(`[Video Status] ${videoUrn} → ${data?.status}`);
      res.json({ status: data?.status, raw: data });
    } catch (err) {
      console.error('[Video Status Error]:', err);
      res.status(500).json({ error: err.message });
    }
  });
}