import React, { useEffect, useState } from 'react';
import { PostDraft } from '../types';

interface Props {
  onRefetchDrafts: () => void;
  draftsList: PostDraft[];
}

export default function QueueTab({ draftsList, onRefetchDrafts }: Props) {
  const [scheduledDrafts, setScheduledDrafts] = useState<PostDraft[]>([]);
  const [editingDraft, setEditingDraft] = useState<PostDraft | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newContent, setNewContent] = useState('');

  useEffect(() => {
    // Filter and sort drafts: active scheduled on top (ascending), published on bottom (descending)
    const filtered = draftsList
      .filter(d => d.status === 'ready' || d.status === 'ready-manual' || d.status === 'posted' || d.status === 'error')
      .sort((a, b) => {
        const isPostedA = a.status === 'posted';
        const isPostedB = b.status === 'posted';

        // 1. Unposted (active) posts go first, posted go last
        if (isPostedA && !isPostedB) return 1;
        if (!isPostedA && isPostedB) return -1;

        // 2. Both are active: sort chronologically by scheduledAt ascending (soonest first)
        if (!isPostedA && !isPostedB) {
          const timeA = a.scheduledAt || 0;
          const timeB = b.scheduledAt || 0;
          return timeA - timeB;
        }

        // 3. Both are posted: sort by postedAt descending (most recently published first)
        const timeA = a.postedAt || 0;
        const timeB = b.postedAt || 0;
        return timeB - timeA;
      });
    setScheduledDrafts(filtered);
  }, [draftsList]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this post from the queue?')) return;
    
    try {
      const response = await fetch(`/api/drafts/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete draft');
      onRefetchDrafts();
    } catch (err) {
      console.error(err);
      alert('Error deleting post');
    }
  };

  const handleEditOpen = (draft: PostDraft) => {
    setEditingDraft(draft);
    setNewContent(draft.content);
    if (draft.scheduledAt) {
      const dateObj = new Date(draft.scheduledAt);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      const hh = String(dateObj.getHours()).padStart(2, '0');
      const min = String(dateObj.getMinutes()).padStart(2, '0');
      
      setNewDate(`${yyyy}-${mm}-${dd}`);
      setNewTime(`${hh}:${min}`);
    } else {
      setNewDate('');
      setNewTime('');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDraft) return;

    let epoch = editingDraft.scheduledAt;
    if (newDate && newTime) {
      epoch = new Date(`${newDate}T${newTime}`).getTime();
    }

    const updatedDraft: PostDraft = {
      ...editingDraft,
      content: newContent,
      scheduledAt: epoch,
      updatedAt: Date.now()
    };

    try {
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedDraft)
      });

      if (!response.ok) throw new Error('Failed to update draft');
      setEditingDraft(null);
      onRefetchDrafts();
    } catch (err) {
      console.error(err);
      alert('Error updating post');
    }
  };

  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'N/A';
    return new Date(ts).toLocaleString(undefined, { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Editor Modal */}
      {editingDraft && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="card-panel" style={{ width: '100%', maxWidth: '700px', background: 'var(--bg-color)', border: '1px solid rgba(99, 102, 241, 0.4)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.5rem' }}>Edit Queued Post</h3>
            
            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Post Commentary</label>
                <textarea 
                  className="form-textarea" 
                  value={newContent} 
                  onChange={e => setNewContent(e.target.value)} 
                  rows={8}
                  required
                />
              </div>

              {editingDraft.scheduledAt && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input 
                      type="date" 
                      className="form-input" 
                      value={newDate} 
                      onChange={e => setNewDate(e.target.value)} 
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Time</label>
                    <input 
                      type="time" 
                      className="form-input" 
                      value={newTime} 
                      onChange={e => setNewTime(e.target.value)} 
                      required
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setEditingDraft(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main List */}
      <div className="card-panel">
        <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '1.5rem' }}>Autopilot Scheduler Queue</h2>

        {scheduledDrafts.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No posts currently scheduled. Generate a draft and add it to the queue!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {scheduledDrafts.map(draft => {
              const isPosted = draft.status === 'posted';
              const isError = draft.status === 'error';
              const isManual = draft.status === 'ready-manual';

              return (
                <div 
                  key={draft.id} 
                  style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px', 
                    background: 'rgba(255,255,255,0.01)', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    overflow: 'hidden' 
                  }}
                >
                  <div style={{ 
                    background: 'rgba(10, 15, 30, 0.4)', 
                    padding: '0.85rem 1.25rem', 
                    borderBottom: '1px solid var(--border-color)', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <span className="event-post-time" style={{ color: isPosted ? '#10b981' : isError ? '#ef4444' : '#3b82f6' }}>
                        {isPosted 
                          ? `Posted: ${formatTimestamp(draft.postedAt)}` 
                          : `Scheduled: ${formatTimestamp(draft.scheduledAt)}`
                        }
                      </span>
                      
                      {isPosted ? (
                        <span className="chip chip-success">✓ Published</span>
                      ) : isError ? (
                        <span className="chip chip-warning" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>⚠️ API Error</span>
                      ) : isManual ? (
                        <span className="chip chip-warning">📋 Copy Ready</span>
                      ) : (
                        <span className="chip chip-primary">⚡ Active Queue</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {!isPosted && (
                        <button className="btn btn-outline" onClick={() => handleEditOpen(draft)} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>
                          Edit
                        </button>
                      )}
                      <button className="btn btn-outline" onClick={() => handleDelete(draft.id)} style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.1)' }}>
                        Remove
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: '1.25rem' }}>
                    <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.6', maxHeight: '180px', overflowY: 'auto' }}>
                      {draft.content}
                    </p>
                    
                    {draft.carouselSlides && draft.carouselSlides.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1rem', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.85rem', borderRadius: '8px', width: 'fit-content' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🎨 Linked PDF Slide Carousel:</span>
                        <span className="chip chip-primary" style={{ fontSize: '0.7rem' }}>{draft.carouselSlides.length} slides</span>
                      </div>
                    )}

                    {isError && draft.errorMessage && (
                      <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.75rem', background: 'rgba(239,68,68,0.05)', padding: '0.5rem', borderRadius: '6px' }}>
                        <strong>Error details:</strong> {draft.errorMessage}
                      </div>
                    )}
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
