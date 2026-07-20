import React, { useState, useEffect } from 'react';
import { UserBrandProfile } from '../types';

interface Props {
  profile: UserBrandProfile | null;
  onProfileUpdate: () => void;
}

export default function BrandProfileTab({ profile, onProfileUpdate }: Props) {
  const [name, setName] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [targetTitle, setTargetTitle] = useState('');
  const [yearsExperience, setYearsExperience] = useState(5);
  const [skillsStr, setSkillsStr] = useState('');
  const [industriesStr, setIndustriesStr] = useState('');
  const [tone, setTone] = useState<UserBrandProfile['tone']>('conversational');
  const [pillarsStr, setPillarsStr] = useState('');
  const [audience, setAudience] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setCurrentTitle(profile.currentTitle || '');
      setTargetTitle(profile.targetTitle || '');
      setYearsExperience(profile.yearsExperience || 5);
      setSkillsStr(profile.skills ? profile.skills.join(', ') : '');
      setIndustriesStr(profile.industries ? profile.industries.join(', ') : '');
      setTone(profile.tone || 'conversational');
      setPillarsStr(profile.contentPillars ? profile.contentPillars.join('\n') : '');
      setAudience(profile.audience || '');
      setLinkedinUrl(profile.linkedinUrl || '');
      setGithubUrl(profile.githubUrl || '');
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);

    const updatedProfile: Partial<UserBrandProfile> = {
      id: profile?.id || 'default-profile',
      name: name || 'Default Profile',
      currentTitle,
      targetTitle,
      yearsExperience: Number(yearsExperience),
      skills: skillsStr.split(',').map(s => s.trim()).filter(Boolean),
      industries: industriesStr.split(',').map(i => i.trim()).filter(Boolean),
      tone,
      contentPillars: pillarsStr.split('\n').map(p => p.trim()).filter(Boolean),
      audience,
      linkedinUrl,
      githubUrl
    };

    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProfile)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${response.status}`);
      }

      // Always cache to localStorage so data survives DB outages/deploys
      localStorage.setItem('poster_profile_cache', JSON.stringify(updatedProfile));

      setSuccess(true);
      onProfileUpdate();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error(err);
      alert('Error saving profile: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-panel">
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1.4rem', fontWeight: '700' }}>Brand Profile Settings</h2>
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Profile Name</label>
            <input 
              type="text" 
              className="form-input" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g. My Personal Brand"
              required 
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Years of Experience</label>
            <input 
              type="number" 
              className="form-input" 
              value={yearsExperience} 
              onChange={e => setYearsExperience(Number(e.target.value))} 
              min="0"
              required 
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Current Job Title</label>
            <input 
              type="text" 
              className="form-input" 
              value={currentTitle} 
              onChange={e => setCurrentTitle(e.target.value)} 
              placeholder="e.g. Senior Data Engineer"
              required 
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Target Job Title (for recruiter target posts)</label>
            <input 
              type="text" 
              className="form-input" 
              value={targetTitle} 
              onChange={e => setTargetTitle(e.target.value)} 
              placeholder="e.g. Lead Data Architect"
              required 
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Skills (comma-separated)</label>
          <input 
            type="text" 
            className="form-input" 
            value={skillsStr} 
            onChange={e => setSkillsStr(e.target.value)} 
            placeholder="e.g. TypeScript, Apache Spark, SQLite, Machine Learning"
            required 
          />
        </div>

        <div className="form-group">
          <label className="form-label">Industries (comma-separated)</label>
          <input 
            type="text" 
            className="form-input" 
            value={industriesStr} 
            onChange={e => setIndustriesStr(e.target.value)} 
            placeholder="e.g. Tech, Finance, SaaS"
            required 
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Writing Tone Style</label>
            <select 
              className="form-select" 
              value={tone} 
              onChange={e => setTone(e.target.value as UserBrandProfile['tone'])}
            >
              <option value="conversational">☕ Conversational & Friendly</option>
              <option value="professional">👔 Professional & Formal</option>
              <option value="authoritative">🎓 Authoritative & Senior</option>
              <option value="story-driven">📖 Scene & Narrative-Driven</option>
            </select>
          </div>
          
          <div className="form-group">
            <label className="form-label">Target Audience</label>
            <input 
              type="text" 
              className="form-input" 
              value={audience} 
              onChange={e => setAudience(e.target.value)} 
              placeholder="e.g. Hiring Managers, Technical Directors"
              required 
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">LinkedIn Profile URL or Handle (For PDF Footers)</label>
            <input 
              type="text" 
              className="form-input" 
              value={linkedinUrl} 
              onChange={e => setLinkedinUrl(e.target.value)} 
              placeholder="e.g. linkedin.com/in/username"
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">GitHub Portfolio URL or Handle (For PDF Footers)</label>
            <input 
              type="text" 
              className="form-input" 
              value={githubUrl} 
              onChange={e => setGithubUrl(e.target.value)} 
              placeholder="e.g. github.com/username or yourwebsite.com"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Content Pillars (one per line)</label>
          <textarea 
            className="form-textarea" 
            value={pillarsStr} 
            onChange={e => setPillarsStr(e.target.value)} 
            placeholder="e.g. Local LLMs & Agents&#10;Data Engineering Pipelines&#10;System Scalability"
            required 
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : '💾 Save Brand Profile'}
          </button>
          
          {success && (
            <span style={{ color: '#10b981', fontSize: '0.9rem', fontWeight: '600', animation: 'fadeIn 0.3s' }}>
              ✓ Profile saved successfully!
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
