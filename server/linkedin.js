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
    // Railway y la mayoría de nubes inyectan 'x-forwarded-proto' para indicar el protocolo externo
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');

    // Forzar https si estamos en producción en Railway
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

    // Guardar temporalmente el estado en memoria o db si fuera necesario para CSRF estricto
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

      // Obtener el perfil del usuario utilizando OpenID Connect (UserInfo endpoint)
      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });

      const userData = await userResponse.json();
      const memberUrn = `urn:li:person:${userData.sub}`;

      // Persistir de forma segura en las funciones asíncronas de Supabase/dbShim
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
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targeter: { requestFilters: [] }
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
        return res.status(response.status).json({ error: 'Error publicando en LinkedIn', details: data });
      }

      res.json({ success: true, postId: response.headers.get('x-linkedin-id') || 'unknown' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoints para inicialización, subida y finalización de chunks de vídeo
  app.post('/api/linkedin/init-video-upload', async (req, res) => {
    const { fileSize, fileSizeBytes } = req.body;
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;
    const authorUrn = settings.linkedinMemberUrn;

    if (!accessToken || !authorUrn) {
      return res.status(401).json({ error: 'No conectado a LinkedIn o credenciales ausentes.' });
    }

    try {
      const size = fileSize ?? fileSizeBytes;

      const response = await fetch('https://api.linkedin.com/v2/videos?action=initializeUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
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

      const data = await response.json();
      if (!response.ok) return res.status(response.status).json(data);

      const value = data.value || {};

      res.json({
        ...value,
        uploadInstructions: value.uploadInstructions,
        videoUrn: value.video,
        uploadToken: value.uploadToken
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

   app.post('/api/linkedin/finalize-video-upload', async (req, res) => {
    const { videoUrn, uploadedPartIds } = req.body;
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;

    if (!accessToken) {
      return res.status(401).json({ error: 'No conectado a LinkedIn o credenciales ausentes.' });
    }

    try {
      const response = await fetch('https://api.linkedin.com/v2/videos?action=finalizeUpload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202601'
        },
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: videoUrn,
            uploadedPartIds: uploadedPartIds
          }
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error('[Finalize Video Error]:', JSON.stringify({
          status: response.status,
          videoUrn,
          uploadedPartIds,
          errData
        }));
        return res.status(response.status).json(errData);
      }

      res.json({ success: true, videoUrn });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });