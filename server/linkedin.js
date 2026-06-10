import express from 'express';

// Helper to get active settings from db.json
function getSettings(db) {
  return db.settings;
}

export function setupLinkedInRoutes(app, db, saveDb) {
  // 1. Generate LinkedIn Authorization URL
  app.get('/api/auth/linkedin/url', (req, res) => {
    const settings = getSettings(db);
    const clientId = settings.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
    
    if (!clientId) {
      return res.status(400).json({ error: 'LinkedIn Client ID not configured in settings.' });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/linkedin/callback`;
    const scopes = ['w_member_social', 'openid', 'profile', 'email'].join(' ');
    const state = Math.random().toString(36).substring(2) + Date.now();
    
    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
    
    res.json({ url: authUrl });
  });

  // 2. LinkedIn OAuth Callback handler
  app.get('/api/auth/linkedin/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(`/?linkedin_error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code) {
      return res.redirect('/?linkedin_error=No code returned');
    }

    const settings = getSettings(db);
    const clientId = settings.linkedinClientId;
    const clientSecret = settings.linkedinClientSecret;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/linkedin/callback`;

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error);
      }

      const accessToken = tokenData.access_token;

      // Fetch member profile URN
      const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Active-Version': '202601' // latest stable
        }
      });

      const userData = await userResponse.json();
      
      // sub represents the subject identifier (member ID)
      const memberId = userData.sub; 
      const memberUrn = `urn:li:person:${memberId}`;

      // Save credentials in db
      db.settings.linkedinAccessToken = accessToken;
      db.settings.linkedinMemberUrn = memberUrn;
      db.settings.linkedinTokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
      saveDb();

      // Redirect back to client dashboard with success
      res.redirect('/?linkedin_status=success');
    } catch (err) {
      console.error('LinkedIn OAuth Error:', err);
      res.redirect(`/?linkedin_error=${encodeURIComponent(err.message)}`);
    }
  });

  // 3a. Initialize video upload — returns uploadUrl to client for direct browser upload
  app.post('/api/linkedin/init-video-upload', async (req, res) => {
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;
    const authorUrn = settings.linkedinMemberUrn;

    if (!accessToken || !authorUrn) {
      return res.status(401).json({ error: 'LinkedIn account not authenticated.' });
    }

    const { fileSize } = req.body;
    if (!fileSize) return res.status(400).json({ error: 'Missing fileSize.' });

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
            fileSizeBytes: fileSize,
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
      const uploadUrl = initData.value?.uploadInstructions?.[0]?.uploadUrl;
      const videoUrn = initData.value?.video;
      const uploadToken = initData.value?.uploadToken;

      if (!uploadUrl || !videoUrn) {
        throw new Error('LinkedIn did not return upload URL or video URN.');
      }

      // Return full uploadInstructions array for chunked upload
      res.json({ success: true, uploadInstructions: initData.value?.uploadInstructions, videoUrn, uploadToken });
    } catch (err) {
      console.error('Video Init Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3b. Finalize video upload after client has PUT binary directly to LinkedIn
  app.post('/api/linkedin/finalize-video-upload', async (req, res) => {
    const settings = getSettings(db);
    const accessToken = settings.linkedinAccessToken;

    if (!accessToken) {
      return res.status(401).json({ error: 'LinkedIn account not authenticated.' });
    }

    const { videoUrn, uploadToken } = req.body;
    if (!videoUrn) return res.status(400).json({ error: 'Missing videoUrn.' });

    try {
      const finalizeResponse = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
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
            uploadToken: uploadToken || '',
            uploadedPartIds: req.body.uploadedPartIds || []
          }
        })
      });

      if (!finalizeResponse.ok) {
        const errText = await finalizeResponse.text();
        throw new Error(`Video finalize failed (${finalizeResponse.status}): ${errText}`);
      }

      res.json({ success: true, videoUrn });
    } catch (err) {
      console.error('Video Finalize Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Post to LinkedIn API
  app.post('/api/linkedin/post', async (req, res) => {
    const { content, videoUrn } = req.body;
    const settings = getSettings(db);
    
    const accessToken = settings.linkedinAccessToken;
    const authorUrn = settings.linkedinMemberUrn;

    if (!accessToken || !authorUrn) {
      return res.status(401).json({ error: 'LinkedIn Account not authenticated. Please log in first.' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Post content cannot be empty.' });
    }

    try {
      // Build post body — include video content block if videoUrn provided
      const postBody = {
        author: authorUrn,
        commentary: content,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        lifecycleState: 'PUBLISHED'
      };

      if (videoUrn) {
        postBody.content = {
          media: {
            id: videoUrn
          }
        };
      }

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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LinkedIn API returned status ${response.status}: ${errorText}`);
      }

      // The post ID is returned in the 'x-linkedin-id' header or within response json
      const responseId = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id');
      const data = await response.json().catch(() => ({}));
      
      const postId = responseId || data.id || `urn:li:share:${Date.now()}`;

      res.json({ success: true, postId });
    } catch (err) {
      console.error('LinkedIn Publish Error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}