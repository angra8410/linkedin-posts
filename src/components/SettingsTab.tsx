import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';

interface Props {
  settings: AppSettings | null;
  onSettingsUpdate: () => void;
}

export default function SettingsTab({ settings, onSettingsUpdate }: Props) {
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [defaultModel, setDefaultModel] = useState('gemma4:12b');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loadingAuthUrl, setLoadingAuthUrl] = useState(false);
  const [linkedInStatus, setLinkedInStatus] = useState<'success' | 'error' | null>(null);
  const [linkedInErrorMsg, setLinkedInErrorMsg] = useState('');

  // Read OAuth callback result from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linkedin_status') === 'success') {
      setLinkedInStatus('success');
      window.history.replaceState({}, '', '/');
      onSettingsUpdate();
      setTimeout(() => setLinkedInStatus(null), 5000);
    }
    if (params.get('linkedin_error')) {
      setLinkedInStatus('error');
      setLinkedInErrorMsg(decodeURIComponent(params.get('linkedin_error') || 'Unknown error'));
      window.history.replaceState({}, '', '/');
      setTimeout(() => setLinkedInStatus(null), 8000);
    }
  }, []);

  useEffect(() => {
    if (settings) {
      setOllamaUrl(settings.ollamaUrl || 'http://localhost:11434');
      setDefaultModel(settings.defaultModel || 'gemma4:12b');
      setTheme(settings.theme || 'dark');
      setClientId(settings.linkedinClientId || '');
      setClientSecret(settings.linkedinClientSecret || '');
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollamaUrl,
          defaultModel,
          theme,
          linkedinClientId: clientId,
          linkedinClientSecret: clientSecret
        })
      });

      if (!response.ok) throw new Error('Failed to save settings');
      onSettingsUpdate();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      alert('Error saving settings');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectLinkedIn = async () => {
    setLoadingAuthUrl(true);
    try {
      const response = await fetch('/api/auth/linkedin/url');
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to get auth URL');
      
      // Redirect browser to LinkedIn OAuth consent screen
      window.location.href = data.url;
    } catch (err: any) {
      console.error(err);
      alert(`LinkedIn connection failed: ${err.message}`);
    } finally {
      setLoadingAuthUrl(false);
    }
  };

  const handleDisconnectLinkedIn = async () => {
    if (!confirm('Are you sure you want to unlink your LinkedIn account?')) return;
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkedinAccessToken: '',
          linkedinMemberUrn: '',
          linkedinTokenExpiresAt: null
        })
      });
      onSettingsUpdate();
    } catch (err) {
      console.error(err);
      alert('Error disconnecting');
    }
  };

  const isConnected = !!settings?.linkedinAccessToken;

  // Token expiry helpers
  const expiresAt = (settings as any)?.linkedinTokenExpiresAt;
  const daysLeft = expiresAt ? Math.floor((expiresAt - Date.now()) / 86400000) : null;
  const tokenExpired = daysLeft !== null && daysLeft <= 0;
  const tokenExpiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft < 14;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* OAuth status toasts */}
      {linkedInStatus === 'success' && (
        <div style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', padding: '0.9rem 1.25rem', borderRadius: '10px', color: '#10b981', fontWeight: 600, fontSize: '0.9rem' }}>
          LinkedIn account connected successfully! The scheduler is now active.
        </div>
      )}
      {linkedInStatus === 'error' && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', padding: '0.9rem 1.25rem', borderRadius: '10px', color: '#ef4444', fontWeight: 600, fontSize: '0.9rem' }}>
          LinkedIn connection failed: {linkedInErrorMsg}
        </div>
      )}

      {/* Settings Form */}
      <div className="card-panel">
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '1.5rem' }}>Ollama LLM Configuration</h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Ollama Host Address</label>
              <input 
                type="text" 
                className="form-input" 
                value={ollamaUrl} 
                onChange={e => setOllamaUrl(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Default Model Name</label>
              <input 
                type="text" 
                className="form-input" 
                value={defaultModel} 
                onChange={e => setDefaultModel(e.target.value)} 
                placeholder="e.g. gemma4:12b"
                required 
              />
            </div>
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', margin: '1rem 0 0.5rem 0' }}>LinkedIn API Client Settings</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Configure these client keys from your developer portal app to enable automatic API publishing.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input 
                type="text" 
                className="form-input" 
                value={clientId} 
                onChange={e => setClientId(e.target.value)} 
                placeholder="e.g. 78xxxyyyzzz"
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input 
                type="password" 
                className="form-input" 
                value={clientSecret} 
                onChange={e => setClientSecret(e.target.value)} 
                placeholder="••••••••••••••••"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Settings'}
            </button>
            
            {success && (
              <span style={{ color: '#10b981', fontSize: '0.9rem', fontWeight: '600' }}>
                Settings saved successfully!
              </span>
            )}
          </div>
        </form>
      </div>

      {/* LinkedIn OAuth Integration Panel */}
      <div className="card-panel">
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '0.5rem' }}>LinkedIn Account Link</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Link your LinkedIn profile to start executing automatic posts via the background scheduler.
        </p>

        {isConnected ? (
          <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ color: '#10b981', fontWeight: '700', fontSize: '1.1rem' }}>
                  {tokenExpired ? 'Token Expired — Reconnect Required' : 'Connected Successfully'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  URN: {settings?.linkedinMemberUrn}
                </div>
                {daysLeft !== null && !tokenExpired && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                    Token valid for <strong style={{ color: tokenExpiringSoon ? '#f59e0b' : '#10b981' }}>{daysLeft} days</strong>
                  </div>
                )}
              </div>
              <button
                className="btn btn-outline"
                onClick={handleDisconnectLinkedIn}
                style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }}
              >
                Disconnect
              </button>
            </div>

            {/* Expiry warning banner */}
            {(tokenExpiringSoon || tokenExpired) && (
              <div style={{
                background: tokenExpired ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${tokenExpired ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                fontSize: '0.82rem',
                color: tokenExpired ? '#ef4444' : '#f59e0b',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <span>
                  {tokenExpired
                    ? 'Your access token has expired. Scheduled posts will fail until you reconnect.'
                    : `Your token expires in ${daysLeft} days. Reconnect soon to avoid interruptions.`}
                </span>
                <button
                  className="btn btn-primary"
                  onClick={handleConnectLinkedIn}
                  disabled={loadingAuthUrl}
                  style={{ whiteSpace: 'nowrap', fontSize: '0.82rem', padding: '0.4rem 0.9rem' }}
                >
                  {loadingAuthUrl ? 'Redirecting...' : 'Reconnect'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed var(--border-color)', padding: '1.5rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Status: <strong>Unlinked</strong>
            </span>
            <button 
              className="btn btn-primary" 
              onClick={handleConnectLinkedIn} 
              disabled={loadingAuthUrl || !clientId || !clientSecret}
              style={{ background: '#0a66c2' }}
            >
              {loadingAuthUrl ? 'Retrieving Authorization Screen...' : 'Login with LinkedIn'}
            </button>
            
            {(!clientId || !clientSecret) && (
              <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>
                Please save your Client ID and Client Secret above first to enable authentication.
              </span>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
