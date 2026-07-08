import { useState, useMemo, useEffect } from 'react';
import { User } from '../../lib/types';
import { ArrowLeft, MessageSquarePlus, CheckCircle2, Circle, Clock, MessageSquare, Loader2 } from 'lucide-react';
import { fmt, tnow } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';

export interface Ticket {
  id: string;
  userId: string;
  userName: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

export const SupportTickets = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [priority, setPriority] = useState<'normal' | 'high' | 'critical'>('normal');
  const [isLoading, setIsLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  const canManage = user.role === 'admin' || user.role === 'super_admin';

  useEffect(() => {
    async function fetchTickets() {
      setIsLoading(true);
      const baseQuery = supabase.from('support_tickets').select('*');
      const query = canManage ? baseQuery : baseQuery.eq('user_id', user.id);
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (!error && data) {
        const mapped = data.map(d => ({
          id: d.id,
          userId: d.user_id,
          userName: d.user_name,
          subject: d.subject,
          description: d.description,
          status: d.status as any,
          createdAt: new Date(d.created_at).toLocaleString('en-GB'),
          resolvedAt: d.resolved_at ? new Date(d.resolved_at).toLocaleString('en-GB') : undefined
        }));
        setTickets(mapped);
      }
      setIsLoading(false);
    }
    fetchTickets();
  }, [user.id, canManage]);

  // If regular user, only show their tickets. If admin, show all.
  const visibleTickets = useMemo(() => {
    let list = tickets;
    if (!canManage) {
      list = list.filter(t => t.userId === user.id);
    }
    return list;
  }, [tickets, user.id, canManage]);

  const handleCreate = async () => {
    if (!subject.trim() || !description.trim()) return;
    
    const newId = `TCK-${Math.floor(1000 + Math.random() * 9000)}`;
    const newTicket: Ticket = {
      id: newId,
      userId: user.id || '',
      userName: user.name,
      subject: subject.trim(),
      description: description.trim(),
      status: 'open',
      createdAt: tnow()
    };
    
    setTickets([newTicket, ...tickets]);
    setIsCreating(false);
    setSubject('');
    setDescription('');

    await supabase.from('support_tickets').insert({
      id: newId,
      user_id: user.id,
      user_name: user.name,
      hub: user.hub,
      hub_id: user.hub_id || null,
      subject: newTicket.subject,
      description: newTicket.description,
      priority,
      status: 'open'
    });
    setPriority('normal');
  };

  const handleUpdateStatus = async (id: string, newStatus: 'open' | 'in_progress' | 'resolved') => {
    setTickets(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          status: newStatus,
          resolvedAt: newStatus === 'resolved' ? tnow() : undefined
        };
      }
      return t;
    }));
    if (selectedTicket && selectedTicket.id === id) {
      setSelectedTicket({ ...selectedTicket, status: newStatus, resolvedAt: newStatus === 'resolved' ? tnow() : undefined });
    }

    const updatePayload: any = { status: newStatus };
    if (newStatus === 'resolved') {
      updatePayload.resolved_at = new Date().toISOString();
      updatePayload.resolved_by = user.name;
    }
    await supabase.from('support_tickets').update(updatePayload).eq('id', id);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] relative animate-in slide-in-from-right overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <button
          onClick={onBack}
          className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer border-none bg-transparent"
        >
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">
          ● ISSUE RESOLUTION
        </span>
      </div>

      {!isCreating && !selectedTicket ? (
        <div className="flex-1 overflow-y-auto">
          <div className="ehi-page-body px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-bold font-sans text-[var(--color-foreground)]">Complain Box</h2>
            <button 
              onClick={() => setIsCreating(true)}
              className="px-3 py-1.5 bg-[var(--color-accent-amber)] hover:bg-amber-500 text-[var(--color-obsidian)] text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1.5"
            >
              <MessageSquarePlus size={14} />
              <span>Report Issue</span>
            </button>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--color-muted)]">
                <Loader2 size={24} className="animate-spin mb-3" />
                <p className="text-[12px] font-mono">Loading tickets...</p>
              </div>
            ) : visibleTickets.length === 0 ? (
              <div className="text-center py-12 border border-[var(--color-border)] rounded-lg bg-[rgba(255,255,255,0.02)] text-[var(--color-muted)]">
                <MessageSquare size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-[13px] font-medium font-sans">No complaints or issues reported.</p>
                <p className="text-[11px] font-mono mt-1 opacity-60">You can use this box to report system or operational issues.</p>
              </div>
            ) : (
              visibleTickets.map(t => (
                <div 
                  key={t.id} 
                  onClick={() => setSelectedTicket(t)}
                  className="p-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-surface-2)] rounded-lg cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-[13px] font-bold text-[var(--color-foreground)]">{t.subject}</h3>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold">
                      {t.status === 'open' && <span className="text-red-400 flex items-center gap-1"><Circle size={10} /> Open</span>}
                      {t.status === 'in_progress' && <span className="text-amber-400 flex items-center gap-1"><Clock size={10} /> In Progress</span>}
                      {t.status === 'resolved' && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10} /> Resolved</span>}
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--color-light-muted)] line-clamp-1 mb-2">
                    {t.description}
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-mono text-[var(--color-muted)]">
                    <span>{t.id} · {t.createdAt}</span>
                    {canManage && <span>Reported by: {t.userName}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </div>
      ) : isCreating ? (
        <div className="flex-1 overflow-y-auto">
          <div className="ehi-page-body px-4 py-4 space-y-4">
            <div className="text-[12px] font-bold text-[var(--color-foreground)] font-sans">New Support Ticket</div>
            <div className="space-y-1.5">
              <label htmlFor="ticket-subject" className="ehi-label">Subject</label>
              <input id="ticket-subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief description of the issue" className="ehi-input" />
            </div>
            <div className="space-y-1.5">
              <label className="ehi-label">Priority</label>
              <div className="grid grid-cols-3 gap-2">
                {(['normal', 'high', 'critical'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`py-2 rounded-lg text-[11px] font-bold font-mono uppercase transition-colors ${
                      priority === p
                        ? p === 'critical' ? 'bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.5)] text-[var(--color-error)]'
                          : p === 'high' ? 'bg-[rgba(245,158,11,0.2)] border border-[rgba(245,158,11,0.5)] text-[var(--color-accent-amber)]'
                          : 'bg-[rgba(16,185,129,0.15)] border border-[rgba(16,185,129,0.4)] text-[var(--color-success)]'
                        : 'bg-[var(--color-surface-card)] border border-[var(--color-border)] text-[var(--color-muted)]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ticket-description" className="ehi-label">Description</label>
              <textarea
                id="ticket-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                placeholder="Describe the issue in detail — include steps to reproduce if applicable"
                className="ehi-input resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setIsCreating(false); setSubject(''); setDescription(''); setPriority('normal'); }} className="flex-1 h-11 border border-[var(--color-border)] rounded-lg text-[12px] font-bold text-[var(--color-muted)]">Cancel</button>
              <button onClick={handleCreate} disabled={!subject.trim() || !description.trim()} className="flex-1 h-11 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold disabled:opacity-50">Submit Ticket</button>
            </div>
          </div>
        </div>
      ) : selectedTicket ? (
        <div className="flex-1 overflow-y-auto">
          <div className="ehi-page-body px-4 py-4">
          <button
            onClick={() => setSelectedTicket(null)}
            className="text-[11px] font-mono text-[var(--color-accent-amber)] hover:underline mb-4 inline-block"
          >
            &larr; Back to list
          </button>

          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-lg p-4 mb-4">
            <div className="flex justify-between items-start mb-4 border-b border-[var(--color-border)] pb-4">
              <div>
                <h2 className="text-[15px] font-bold text-[var(--color-foreground)] mb-1">{selectedTicket.subject}</h2>
                <div className="text-[10px] font-mono text-[var(--color-muted)]">
                  Ticket ID: {selectedTicket.id}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold px-2 py-1 bg-[var(--color-border)] rounded">
                {selectedTicket.status === 'open' && <span className="text-red-400 flex items-center gap-1"><Circle size={12} /> Open</span>}
                {selectedTicket.status === 'in_progress' && <span className="text-amber-400 flex items-center gap-1"><Clock size={12} /> In Progress</span>}
                {selectedTicket.status === 'resolved' && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Resolved</span>}
              </div>
            </div>

            <div className="space-y-4 text-[13px] text-[var(--color-light-muted)]">
              <div>
                <strong className="text-[11px] font-mono text-[var(--color-muted)] uppercase block mb-1">Description</strong>
                <p className="whitespace-pre-wrap">{selectedTicket.description}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 mt-4">
                <div>
                  <strong className="text-[10px] font-mono text-[var(--color-muted)] uppercase block mb-1">Reported By</strong>
                  <span className="font-medium text-[var(--color-foreground)]">{selectedTicket.userName}</span>
                </div>
                <div>
                  <strong className="text-[10px] font-mono text-[var(--color-muted)] uppercase block mb-1">Created At</strong>
                  <span className="font-medium text-[var(--color-foreground)]">{selectedTicket.createdAt}</span>
                </div>
                {selectedTicket.resolvedAt && (
                  <div className="col-span-2">
                    <strong className="text-[10px] font-mono text-[var(--color-muted)] uppercase block mb-1">Resolved At</strong>
                    <span className="font-medium text-emerald-400">{selectedTicket.resolvedAt}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-[11px] font-mono text-[var(--color-muted)] uppercase mb-3">Admin Actions</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateStatus(selectedTicket.id, 'open')}
                  disabled={selectedTicket.status === 'open'}
                  className="flex-1 py-2 bg-[rgba(239,68,68,0.1)] text-red-400 text-[11px] font-bold rounded-lg border border-[rgba(239,68,68,0.2)] disabled:opacity-50"
                >Mark Open</button>
                <button
                  onClick={() => handleUpdateStatus(selectedTicket.id, 'in_progress')}
                  disabled={selectedTicket.status === 'in_progress'}
                  className="flex-1 py-2 bg-[rgba(245,158,11,0.1)] text-amber-400 text-[11px] font-bold rounded-lg border border-[rgba(245,158,11,0.2)] disabled:opacity-50"
                >In Progress</button>
                <button
                  onClick={() => handleUpdateStatus(selectedTicket.id, 'resolved')}
                  disabled={selectedTicket.status === 'resolved'}
                  className="flex-1 py-2 bg-[rgba(16,185,129,0.1)] text-emerald-400 text-[11px] font-bold rounded-lg border border-[rgba(16,185,129,0.2)] disabled:opacity-50"
                >Resolve</button>
              </div>
            </div>
          )}
          </div>{/* end ehi-page-body */}
        </div>
      ) : null}
    </div>
  );
};
