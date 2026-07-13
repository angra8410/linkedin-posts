/// <reference types="react" />
import React, { useEffect, useState, useRef } from 'react';
import { PerformanceLog, PostDraft } from '../types';
import * as XLSX from 'xlsx';


interface Props {
  logsList: PerformanceLog[];
  onRefetchLogs: () => void;
}

interface ParsedCSVPost {
  url: string;
  postId: string;
  publishDate: number;
  engagements: number;
  impressions?: number;
  pillar: string;
  hashtags?: string[];
  mediaFormat?: 'carousel' | 'video' | 'text';
  title: string;
  isMatched: boolean;
  matchedDraftId?: string;
}

export default function AnalyticsTab({ logsList, onRefetchLogs }: Props) {
  const [selectedLog, setSelectedLog] = useState<PerformanceLog | null>(null);
  const [impressions, setImpressions] = useState(0);
  const [reactions, setReactions] = useState(0);
  const [comments, setComments] = useState(0);
  const [reposts, setReposts] = useState(0);
  const [profileViews, setProfileViews] = useState(0);
  const [notes, setNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  // CSV State
  const [parsedPosts, setParsedPosts] = useState<ParsedCSVPost[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [importingCSV, setImportingCSV] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load drafts to match CSV against
  const [allDrafts, setAllDrafts] = useState<PostDraft[]>([]);

  useEffect(() => {
    fetch('/api/drafts')
      .then(res => res.json())
      .then(data => setAllDrafts(data))
      .catch(err => console.error(err));
  }, [logsList]);

  const handleEditOpen = (log: PerformanceLog) => {
    setSelectedLog(log);
    setImpressions(log.impressions || 0);
    setReactions(log.reactions || 0);
    setComments(log.comments || 0);
    setReposts(log.reposts || 0);
    setProfileViews(log.profileViews || 0);
    setNotes(log.notes || '');
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLog) return;
    setUpdating(true);

    const updatedLog: PerformanceLog = {
      ...selectedLog,
      impressions: Number(impressions),
      reactions: Number(reactions),
      comments: Number(comments),
      reposts: Number(reposts),
      profileViews: Number(profileViews),
      notes: notes,
      updatedAt: Date.now()
    };

    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedLog)
      });

      if (!response.ok) throw new Error('Failed to update metrics');
      setSelectedLog(null);
      onRefetchLogs();
    } catch (err) {
      console.error(err);
      alert('Error updating metrics');
    } finally {
      setUpdating(false);
    }
  };

// XLSX parsing & ID extraction engine
const extractPostId = (rawUrl: string): string => {
  const idMatch =
    rawUrl.match(/(?:ugcPost|share|activity|document|posts)-([0-9]{15,})/i) ||
    rawUrl.match(/-([0-9]{15,})/);
  return idMatch ? idMatch[1] : '';
};

const findHeaderRowIndex = (rows: any[][]): number => {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.some(cell => typeof cell === 'string' && cell.toLowerCase().includes('post url'))) {
      return i;
    }
  }
  return -1;
};

interface TopPostRaw {
  postId: string;
  url: string;
  publishDate: number;
  engagements?: number;
  impressions?: number;
}

const parseTopPostsSheet = (sheet: XLSX.WorkSheet): TopPostRaw[] => {
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) {
    throw new Error('Could not find a "Post URL" header in the TOP POSTS sheet.');
  }

  const headerRow = (rows[headerIdx] || []).map(c => (c ?? '').toString().toLowerCase());
  const urlCols = headerRow.reduce<number[]>(
    (acc, cell, idx) => (cell.includes('post url') ? [...acc, idx] : acc),
    []
  );
  if (urlCols.length === 0) {
    throw new Error('No "Post URL" columns found in the TOP POSTS sheet.');
  }

  const merged = new Map<string, TopPostRaw>();

  urlCols.forEach((urlCol, blockIdx) => {
    const dateCol = urlCol + 1;
    const metricCol = urlCol + 2;
    const metricHeader = headerRow[metricCol] || '';
    const isImpressionBlock = metricHeader.includes('impression');
    const isEngagementBlock = metricHeader.includes('engagement');

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const rawUrl = row[urlCol];
      if (typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) continue;

      const postId = extractPostId(rawUrl);
      if (!postId) continue;

      const rawDate = row[dateCol];
      const publishDate = rawDate ? new Date(rawDate).getTime() : Date.now();
      const rawMetric = row[metricCol];
      const metricValue =
        typeof rawMetric === 'number' ? rawMetric : parseInt(String(rawMetric ?? '0').replace(/,/g, '')) || 0;

      const existing = merged.get(postId) ?? { postId, url: rawUrl, publishDate };
      if (isImpressionBlock) {
        existing.impressions = metricValue;
      } else if (isEngagementBlock) {
        existing.engagements = metricValue;
      } else {
        if (blockIdx === 0) existing.engagements = metricValue;
        else existing.impressions = metricValue;
      }
      merged.set(postId, existing);
    }
  });

  return Array.from(merged.values());
};

const handleXLSXUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setCsvFileName(file.name);
  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames.find(n => n.toUpperCase().includes('TOP POSTS'));
      if (!sheetName) {
        throw new Error('Could not find a "TOP POSTS" sheet in this file.');
      }

      const topPosts = parseTopPostsSheet(workbook.Sheets[sheetName]);

      const tempParsed: ParsedCSVPost[] = topPosts.map(tp => {
        const matchedDraft = allDrafts.find(d =>
          (d.linkedinPostId && d.linkedinPostId.includes(tp.postId)) ||
          (d.content && d.content.toLowerCase().includes(tp.postId))
        );

        let matchedPillar = 'General';
        if (matchedDraft?.pillar) {
          matchedPillar = matchedDraft.pillar;
        } else {
          const urlLower = tp.url.toLowerCase();
          if (urlLower.includes('quality') || urlLower.includes('governance')) {
            matchedPillar = 'Data Quality vs Data Volume';
          } else if (urlLower.includes('ollama') || urlLower.includes('agent') || urlLower.includes('llm')) {
            matchedPillar = 'Local LLMs & AI Agents';
          } else if (urlLower.includes('architecture') || urlLower.includes('design') || urlLower.includes('fabric')) {
            matchedPillar = 'System Design & Architecture';
          } else if (urlLower.includes('powerbi') || urlLower.includes('power-bi')) {
            matchedPillar = 'Power BI';
          }
        }

        let title: string;
        if (matchedDraft?.content) {
          const cleaned = matchedDraft.content.replace(/\n+/g, ' ').trim();
          title = cleaned.substring(0, 40) + (cleaned.length > 40 ? '...' : '');
        } else {
          const slugMatch = tp.url.match(/posts\/([a-zA-Z0-9\-_]+)/);
          const slug = slugMatch ? slugMatch[1] : '';
          const cleanedTitle = slug
            .replace(/^antoniogutierrez-data_/i, '')
            .replace(/-(?:ugcPost|share|activity|document).*$/i, '')
            .split('_')
            .join(' ')
            .split('-')
            .join(' ');
          title = cleanedTitle.substring(0, 40) + (cleanedTitle.length > 40 ? '...' : '');
        }

        const inferredMediaFormat: 'carousel' | 'video' | 'text' | undefined = matchedDraft
          ? matchedDraft.carouselSlides && matchedDraft.carouselSlides.length > 0
            ? 'carousel'
            : matchedDraft.videoUrn
            ? 'video'
            : 'text'
          : undefined;

        return {
          url: tp.url,
          postId: tp.postId,
          publishDate: tp.publishDate,
          engagements: tp.engagements ?? 0,
          impressions: tp.impressions,
          pillar: matchedPillar,
          hashtags: matchedDraft?.hashtags,
          mediaFormat: inferredMediaFormat,
          title: title || `LinkedIn Share #${tp.postId.substring(0, 6)}`,
          isMatched: !!matchedDraft,
          matchedDraftId: matchedDraft?.id
        };
      });

      setParsedPosts(tempParsed);
    } catch (err: any) {
      alert(`Failed to parse file: ${err.message}`);
      setParsedPosts([]);
    }
  };

  reader.readAsArrayBuffer(file);
};

  // Submit bulk reconciliation to backend
  const handleConfirmImport = async () => {
    if (parsedPosts.length === 0) return;
    setImportingCSV(true);

    // Prepare drafts to update status
    const draftsToUpdate = parsedPosts
      .filter(p => p.isMatched && p.matchedDraftId)
      .map(p => {
        const original = allDrafts.find(d => d.id === p.matchedDraftId);
        return {
          ...(original || {}),
          id: p.matchedDraftId!,
          status: 'posted' as const,
          postedAt: p.publishDate,
          linkedinPostId: p.postId
        };
      });

// Prepare performance logs to insert or update.
      const logsToInsert = parsedPosts.map(p => {
      const existingLog = logsList.find(l =>
        (p.matchedDraftId && l.sourceDraftId === p.matchedDraftId) ||
        l.linkedinPostId === p.postId
      );
      const hasRealImpressions = typeof p.impressions === 'number';

      return {
        id: existingLog?.id,
        sourceDraftId: p.matchedDraftId || undefined,
        linkedinPostId: p.postId,
        postTitle: p.title,
        postedAt: p.publishDate,
        pillar: p.pillar,
        hashtags: p.hashtags,
        mediaFormat: p.mediaFormat,
        format: p.url.includes('document') ? ('data' as const) : ('insight' as const),
        impressions: hasRealImpressions ? p.impressions! : p.engagements * 12,
        reactions: p.engagements,
        comments: 0,
        reposts: 0,
        profileViews: 0,
        notes: hasRealImpressions
          ? `Reconciled via XLSX Upload. ID: ${p.postId}`
          : `Reconciled via XLSX Upload (impressions estimated — post not in impression-ranked list). ID: ${p.postId}`
      };
    });

    try {
      const response = await fetch('/api/logs/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logs: logsToInsert,
          drafts: draftsToUpdate
        })
      });

      if (!response.ok) throw new Error('Bulk import reconciliation failed');

      alert(`Successfully reconciled ${draftsToUpdate.length} drafts and imported ${logsToInsert.length} performance logs!`);
      setParsedPosts([]);
      setCsvFileName('');
      onRefetchLogs();
    } catch (err: any) {
      console.error(err);
      alert(`Error during bulk import: ${err.message}`);
    } finally {
      setImportingCSV(false);
    }
  };

  // Aggregated data by content pillar for CSS chart
  const getPillarData = () => {
    const dataMap: Record<string, { impressions: number, engagement: number, count: number }> = {};
    
    logsList.forEach(log => {
      const p = log.pillar || 'General';
      if (!dataMap[p]) {
        dataMap[p] = { impressions: 0, engagement: 0, count: 0 };
      }
      dataMap[p].impressions += log.impressions || 0;
      dataMap[p].engagement += (log.reactions || 0) + (log.comments || 0) + (log.reposts || 0);
      dataMap[p].count += 1;
    });

    return Object.entries(dataMap).map(([name, val]) => ({
      name,
      impressions: val.impressions,
      engagement: val.engagement,
      avgEngagement: val.count > 0 ? Math.round(val.engagement / val.count) : 0
    }));
  };

  const pillarChartData = getPillarData();
  const maxImpressions = Math.max(...pillarChartData.map(d => d.impressions), 1);
  const maxEngagement = Math.max(...pillarChartData.map(d => d.avgEngagement), 1);

  // Aggregated data by hashtag — fan-out: a post with 3 hashtags counts once per hashtag
  const getHashtagData = () => {
    const dataMap: Record<string, { impressions: number, engagement: number, count: number }> = {};

    logsList.forEach(log => {
      const tags = log.hashtags && log.hashtags.length > 0 ? log.hashtags : [];
      tags.forEach(tag => {
        if (!dataMap[tag]) {
          dataMap[tag] = { impressions: 0, engagement: 0, count: 0 };
        }
        dataMap[tag].impressions += log.impressions || 0;
        dataMap[tag].engagement += (log.reactions || 0) + (log.comments || 0) + (log.reposts || 0);
        dataMap[tag].count += 1;
      });
    });

    return Object.entries(dataMap)
      .map(([name, val]) => ({
        name,
        impressions: val.impressions,
        count: val.count,
        avgImpressions: val.count > 0 ? Math.round(val.impressions / val.count) : 0,
        avgEngagement: val.count > 0 ? Math.round(val.engagement / val.count) : 0
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);
  };

  // Aggregated data by media format (carousel / video / text)
  const getMediaFormatData = () => {
    const dataMap: Record<string, { impressions: number, engagement: number, count: number }> = {};

    logsList.forEach(log => {
      const fmt = log.mediaFormat || 'Unknown';
      if (!dataMap[fmt]) {
        dataMap[fmt] = { impressions: 0, engagement: 0, count: 0 };
      }
      dataMap[fmt].impressions += log.impressions || 0;
      dataMap[fmt].engagement += (log.reactions || 0) + (log.comments || 0) + (log.reposts || 0);
      dataMap[fmt].count += 1;
    });

    return Object.entries(dataMap).map(([name, val]) => ({
      name,
      impressions: val.impressions,
      count: val.count,
      avgImpressions: val.count > 0 ? Math.round(val.impressions / val.count) : 0,
      avgEngagement: val.count > 0 ? Math.round(val.engagement / val.count) : 0
    }));
  };

  const allHashtagData = getHashtagData();
  const qualifiedHashtagData = allHashtagData.filter(d => d.count >= 2);
  const excludedSingletonCount = allHashtagData.length - qualifiedHashtagData.length;
  const hashtagChartData = qualifiedHashtagData.slice(0, 10); // top 10 by avg engagement, 2+ posts only
  const maxHashtagEngagement = Math.max(...hashtagChartData.map(d => d.avgEngagement), 1);


  const mediaFormatChartData = getMediaFormatData();
  const maxMediaFormatImpressions = Math.max(...mediaFormatChartData.map(d => d.impressions), 1);
  const maxMediaFormatEngagement = Math.max(...mediaFormatChartData.map(d => d.avgEngagement), 1);

  // Export reconciled logs for Fabric Lakehouse ingestion: fact table + hashtag bridge table
const handleExportForFabric = () => {
  if (logsList.length === 0) {
    alert('No performance logs to export yet.');
    return;
  }

  // Sheet 1: Posts (fact table) — one row per post
  const postsSheet = logsList.map(log => ({
    post_id: log.id,
    linkedin_post_id: log.linkedinPostId || '',
    source_draft_id: log.sourceDraftId || '',
    posted_at: log.postedAt ? new Date(log.postedAt).toISOString() : '',
    pillar: log.pillar || 'General',
    media_format: log.mediaFormat || 'Unknown',
    content_genre_format: log.format || '',
    impressions: log.impressions || 0,
    reactions: log.reactions || 0,
    comments: log.comments || 0,
    reposts: log.reposts || 0,
    profile_views: log.profileViews || 0,
    engagement_total: (log.reactions || 0) + (log.comments || 0) + (log.reposts || 0),
    post_title: log.postTitle || '',
    notes: log.notes || ''
  }));

  // Sheet 2: PostHashtags (bridge table) — one row per (post_id, hashtag) pair
  const hashtagBridge: { post_id: string; hashtag: string }[] = [];
  logsList.forEach(log => {
    (log.hashtags || []).forEach(tag => {
      hashtagBridge.push({ post_id: log.id, hashtag: tag });
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(postsSheet), 'Posts');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hashtagBridge), 'PostHashtags');

  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `linkedin_fabric_export_${dateStr}.xlsx`);
};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Metrics Editor Modal */}
      {selectedLog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="card-panel" style={{ width: '100%', maxWidth: '600px', background: 'var(--bg-color)', border: '1px solid rgba(99, 102, 241, 0.4)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.5rem' }}>Update Post Performance</h3>
            
            <form onSubmit={handleUpdateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Impressions (Views)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={impressions} 
                    onChange={e => setImpressions(Number(e.target.value))} 
                    min="0"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Reactions</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={reactions} 
                    onChange={e => setReactions(Number(e.target.value))} 
                    min="0"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Comments</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={comments} 
                    onChange={e => setComments(Number(e.target.value))} 
                    min="0"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Reposts</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={reposts} 
                    onChange={e => setReposts(Number(e.target.value))} 
                    min="0"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Profile Views</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={profileViews} 
                    onChange={e => setProfileViews(Number(e.target.value))} 
                    min="0"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notes</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Discussed local LLM performance"
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setSelectedLog(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={updating}>
                  {updating ? 'Saving...' : 'Save Metrics'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Dropzone Panel */}
      <div className="card-panel">
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '0.5rem' }}>Weekly CSV Performance Importer</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Upload your weekly spreadsheet export to match generated drafts and sync engagements automatically.
        </p>

        <div 
          onClick={() => fileInputRef.current?.click()}
          style={{ 
            border: '2px dashed var(--border-color)', 
            borderRadius: '16px', 
            padding: '2.5rem', 
            textAlign: 'center', 
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.01)',
            transition: 'var(--transition-smooth)'
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleXLSXUpload}  
            accept=".xlsx" 
            style={{ display: 'none' }} 
          />
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📂</div>
          <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
            {csvFileName ? `Selected: ${csvFileName}` : 'Select your weekly Aggregate Analytics .xlsx export'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Reads the "TOP POSTS" sheet — merges the engagement-ranked and impression-ranked tables automatically
          </div>
        </div>

        {/* CSV Preview and Sync Board */}
        {parsedPosts.length > 0 && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Reconciliation Board ({parsedPosts.length} posts found)</h3>
              
              <button 
                className="btn btn-accent" 
                onClick={handleConfirmImport} 
                disabled={importingCSV}
                style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
              >
                {importingCSV ? 'Importing...' : '⚡ Confirm & Sync Board'}
              </button>
            </div>

            <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(10,15,30,0.6)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.5rem 1rem' }}>Headline (URL Slug)</th>
                    <th style={{ padding: '0.5rem 1rem' }}>Extracted URN</th>
                    <th style={{ padding: '0.5rem 1rem' }}>Engagements</th>
                    <th style={{ padding: '0.5rem 1rem' }}>Content Pillar</th>
                    <th style={{ padding: '0.5rem 1rem' }}>Match Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedPosts.map((post, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: post.isMatched ? 'rgba(16, 185, 129, 0.05)' : 'none' }}>
                      <td style={{ padding: '0.5rem 1rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title}</td>
                      <td style={{ padding: '0.5rem 1rem', fontFamily: 'monospace' }}>{post.postId}</td>
                      <td style={{ padding: '0.5rem 1rem', fontWeight: '700' }}>{post.engagements}</td>
                      <td style={{ padding: '0.5rem 1rem' }}>{post.pillar}</td>
                      <td style={{ padding: '0.5rem 1rem' }}>
                        {post.isMatched ? (
                          <span style={{ color: '#10b981', fontWeight: '600' }}>✓ Match Draft</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>+ Import History</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Visual Analytics Charts */}
      {logsList.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          
          <div className="card-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Total Impressions by Content Pillar</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sum of views across all posts in each pillar</p>
            
            <div className="chart-container">
              {pillarChartData.map(d => {
                const pct = (d.impressions / maxImpressions) * 100;
                return (
                  <div key={d.name} className="chart-bar-wrapper">
                    <div className="chart-bar" style={{ height: `${Math.max(pct, 4)}%` }}>
                      <span className="chart-bar-value">{d.impressions.toLocaleString()}</span>
                    </div>
                    <span className="chart-bar-label">{d.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Avg Engagement by Content Pillar</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Avg (Reactions + Comments + Reposts) per post</p>
            
            <div className="chart-container">
              {pillarChartData.map(d => {
                const pct = (d.avgEngagement / maxEngagement) * 100;
                return (
                  <div key={d.name} className="chart-bar-wrapper">
                    <div className="chart-bar" style={{ height: `${Math.max(pct, 4)}%`, background: 'var(--accent-gradient)' }}>
                      <span className="chart-bar-value">{d.avgEngagement}</span>
                    </div>
                    <span className="chart-bar-label">{d.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* Hashtag & Media Format Analytics */}
      {logsList.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

          <div className="card-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Avg Engagement by Hashtag (Top 10)</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              A post counts once per hashtag it carries. Hover a bar to see post count.
            </p>
            {excludedSingletonCount > 0 && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.25rem' }}>
                {excludedSingletonCount} hashtag{excludedSingletonCount === 1 ? '' : 's'} used on only 1 post excluded — not enough data yet to rank reliably.
              </p>
            )}

            {allHashtagData.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                No hashtag data yet — re-import your weekly file to backfill hashtags onto existing logs.
              </div>
            ) : hashtagChartData.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                Every hashtag so far has only 1 post — check back once you have repeat usage on at least one tag.
              </div>
            ) : (
              <div className="chart-container">
                {hashtagChartData.map(d => {
                  const pct = (d.avgEngagement / maxHashtagEngagement) * 100;
                  return (
                    <div key={d.name} className="chart-bar-wrapper" title={`${d.count} post${d.count === 1 ? '' : 's'}`}>
                      <div className="chart-bar" style={{ height: `${Math.max(pct, 4)}%`, background: 'var(--accent-gradient)' }}>
                        <span className="chart-bar-value">{d.avgEngagement}</span>
                      </div>
                      <span className="chart-bar-label">{d.name} ({d.count})</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Impressions & Engagement by Format</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Carousel vs. video vs. text-only</p>

            {mediaFormatChartData.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.85rem' }}>
                No media format data yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
                {mediaFormatChartData.map(d => (
                  <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    <span style={{ textTransform: 'capitalize', fontWeight: '600' }}>{d.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8rem' }}>({d.count})</span></span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Avg impressions: <strong>{d.avgImpressions}</strong> · Avg engagement: <strong style={{ color: '#3b82f6' }}>{d.avgEngagement}</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Published Log List */}
      <div className="card-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', margin: 0 }}>
            Published Content Logs
          </h2>

          {logsList.length > 0 && (
            <button 
              className="btn btn-outline" 
              onClick={handleExportForFabric} 
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
            >
              ⬇️ Export for Fabric
            </button>
          )}
        </div>

        {logsList.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No posts logged yet. Autopilot posts will automatically generate a log here once published!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {logsList.sort((a,b) => b.postedAt - a.postedAt).map(log => {
              const totalEngagement = (log.reactions || 0) + (log.comments || 0) + (log.reposts || 0);
              
              return (
                <div 
                  key={log.id} 
                  style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px', 
                    padding: '1.25rem',
                    background: 'rgba(255,255,255,0.01)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '1rem'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <span className="chip chip-primary" style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                        {log.pillar || 'General'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {new Date(log.postedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: '600', color: '#fff' }}>
                      {log.postTitle}
                    </h4>
                    {log.notes && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Notes: {log.notes}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Impressions</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: '700' }}>{log.impressions || 0}</div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Engagement</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#3b82f6' }}>{totalEngagement}</div>
                      </div>
                    </div>

                    <button 
                      className="btn btn-outline" 
                      onClick={() => handleEditOpen(log)}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                    >
                      ✏️ Update Metrics
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
