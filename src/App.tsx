import { useState, useEffect } from 'react';
import { UserBrandProfile, AppSettings, PostDraft, PerformanceLog } from './types';
import BrandProfileTab from './components/BrandProfileTab';
import DraftTab from './components/DraftTab';
import QueueTab from './components/QueueTab';
import AnalyticsTab from './components/AnalyticsTab';
import SettingsTab from './components/SettingsTab';
import { User, Zap, Calendar, BarChart3, Settings } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'profile' | 'draft' | 'queue' | 'analytics' | 'settings'>('draft');
  const [profile, setProfile] = useState<UserBrandProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draftsList, setDraftsList] = useState<PostDraft[]>([]);
  const [logsList, setLogsList] = useState<PerformanceLog[]>([]);

  // DB Sync Functions
  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setSettings(data);
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const fetchProfiles = async () => {
    try {
      const response = await fetch('/api/profiles');
      const data = await response.json();
      // Select the active profile from settings
      const activeId = settings?.activeProfileId;
      const active = data.find((p: any) => p.id === activeId) || data[0] || null;
      setProfile(active);
    } catch (err) {
      console.error('Error fetching profiles:', err);
    }
  };

  const fetchDrafts = async () => {
    try {
      const response = await fetch('/api/drafts');
      const data = await response.json();
      setDraftsList(data);
    } catch (err) {
      console.error('Error fetching drafts:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/logs');
      const data = await response.json();
      setLogsList(data);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  // Run initial fetches
  useEffect(() => {
    fetchSettings();
    fetchDrafts();
    fetchLogs();
  }, []);

  // Fetch profile when settings are loaded or changed
  useEffect(() => {
    fetchProfiles();
  }, [settings]);

  // Handle OAuth callback parameters in address bar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('linkedin_status');
    const error = params.get('linkedin_error');

    if (status === 'success') {
      alert('🎉 LinkedIn account connected successfully!');
      fetchSettings();
      // Clean query params
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (error) {
      alert(`❌ LinkedIn link failed: ${decodeURIComponent(error)}`);
      // Clean query params
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <nav className="sidebar">
        <div>
          <div className="logo-section">
            <div className="logo-icon">⚡</div>
            <div className="logo-text">Poster.ai</div>
          </div>
          
          <ul className="nav-links">
            <li className={`nav-item ${activeTab === 'draft' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('draft')}>
                <Zap size={18} />
                Autopilot
              </button>
            </li>
            
            <li className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('queue')}>
                <Calendar size={18} />
                Schedule Queue
              </button>
            </li>

            <li className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('profile')}>
                <User size={18} />
                Brand Profile
              </button>
            </li>

            <li className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}>
              <button onClick={() => setActiveTab('analytics')}>
                <BarChart3 size={18} />
                Analytics
              </button>
            </li>
          </ul>
        </div>

        <div className="nav-links" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
          <li className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}>
            <button onClick={() => setActiveTab('settings')}>
              <Settings size={18} />
              Settings
            </button>
          </li>
        </div>
      </nav>

      {/* Main Panel Content */}
      <main className="main-content">
        <header className="header-bar">
          <div>
            <h1 className="page-title">
              {activeTab === 'draft' && '⚡ Autopilot Creator'}
              {activeTab === 'queue' && '📅 Queue Timeline'}
              {activeTab === 'profile' && '👤 Personal Branding'}
              {activeTab === 'analytics' && '📊 Post Performance Analytics'}
              {activeTab === 'settings' && '⚙️ App Configuration'}
            </h1>
            <p className="page-subtitle">
              {activeTab === 'draft' && 'Autonomously generate, rate, and publish LinkedIn shares.'}
              {activeTab === 'queue' && 'Monitor and rearrange scheduled content items.'}
              {activeTab === 'profile' && 'Tune your LLM copywriter to your experience and tone.'}
              {activeTab === 'analytics' && 'Monitor impressions and engagement rates across content pillars.'}
              {activeTab === 'settings' && 'Edit connection variables and OAuth client keys.'}
            </p>
          </div>
          
          {profile && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: '700', color: '#fff' }}>{profile.name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{profile.currentTitle}</span>
            </div>
          )}
        </header>

        {/* Tab Router Switch */}
        {activeTab === 'draft' && (
          <DraftTab 
            profile={profile} 
            settings={settings} 
          />
        )}
        
        {activeTab === 'queue' && (
          <QueueTab 
            draftsList={draftsList} 
            onRefetchDrafts={fetchDrafts} 
          />
        )}
        
        {activeTab === 'profile' && (
          <BrandProfileTab 
            profile={profile} 
            onProfileUpdate={fetchProfiles} 
          />
        )}
        
        {activeTab === 'analytics' && (
          <AnalyticsTab 
            logsList={logsList} 
            onRefetchLogs={fetchLogs} 
          />
        )}
        
        {activeTab === 'settings' && (
          <SettingsTab 
            settings={settings} 
            onSettingsUpdate={fetchSettings} 
          />
        )}
      </main>
    </div>
  );
}
