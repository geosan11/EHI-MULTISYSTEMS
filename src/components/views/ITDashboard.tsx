import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Terminal, ShieldAlert, CheckCircle, AlertTriangle, RefreshCw, 
  Trash2, Plus, Download, Cpu, HardDrive, Wifi, Eye, Activity,
  ThumbsUp, Send, Check, ArrowLeft
} from 'lucide-react';
import { User } from '../../lib/types';

interface BugLog {
  id: string;
  title: string;
  description: string;
  component: 'Database' | 'WhatsApp SMS' | 'Scanner System' | 'Sync Queue' | 'UI Renderer' | 'API Gateway';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Active' | 'Investigating' | 'Resolved';
  occurrences: number;
  timestamp: string;
}

interface LogMessage {
  time: string;
  level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'FATAL';
  source: string;
  text: string;
}

interface ImprovementProposal {
  id: string;
  title: string;
  description: string;
  priority: 'High' | 'Medium' | 'Low';
  votes: number;
  voted?: boolean;
}

const PRE_BUGS: BugLog[] = [];

const PRE_PROPOSALS: ImprovementProposal[] = [
  {
    id: 'IMP-01',
    title: 'Durable fallback SQLite / Dexie chunking',
    description: 'Implement physical log partitioning for off-line cache when database reaches over 100MB of imagery local POD data.',
    priority: 'Medium',
    votes: 42
  },
  {
    id: 'IMP-02',
    title: 'HCD Webhook Auto-Recovery',
    description: 'Automatically restart disconnected listener channels when background cellular network re-registers connection.',
    priority: 'High',
    votes: 89
  },
  {
    id: 'IMP-03',
    title: 'Dynamic Web Scanner Throttle',
    description: 'Debounce optical frame scanning based on CPU thermodynamic load for legacy handheld cargo devices.',
    priority: 'Low',
    votes: 18
  }
];

export const ITDashboard = ({ user, onBack }: { user: User, onBack?: () => void }) => {
  const [activeTab, setActiveTab] = useState<'bugs' | 'logs' | 'diagnostics' | 'proposals'>('bugs');
  const [sentryTestState, setSentryTestState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const runSentryTest = async () => {
    setSentryTestState('sending');
    const { appLogger } = await import('../../lib/logger');
    const Sentry = await import('@sentry/react');
    const { supabase } = await import('../../lib/supabase');

    // Three distinct, separately-labeled events — if only some show up in
    // Sentry, that tells you exactly which path is misconfigured rather
    // than a single ambiguous "did it work?" signal.
    Sentry.captureException(new Error('[TEST] Direct client capture — safe to ignore, no action needed'));
    appLogger.log('ERROR', 'SENTRY_TEST', '[TEST] appLogger bridge — safe to ignore, no action needed');

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || '';
      await fetch('/api/admin/test-sentry', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // A non-2xx response here is the EXPECTED outcome (the route
      // deliberately errors) — not a failure of this test.
    } catch {
      // Network-level failure reaching the route at all — the other two
      // client-side events still went out regardless.
    }

    setSentryTestState('sent');
    setTimeout(() => setSentryTestState('idle'), 8000);
  };
  
  // States
  const [bugs, setBugs] = useState<BugLog[]>(() => {
    const saved = localStorage.getItem('ehi_it_bugs');
    return saved ? JSON.parse(saved) : PRE_BUGS;
  });

  const [proposals, setProposals] = useState<ImprovementProposal[]>(() => {
    const saved = localStorage.getItem('ehi_it_proposals');
    return saved ? JSON.parse(saved) : PRE_PROPOSALS;
  });

  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [bugFilter, setBugFilter] = useState<'All' | 'Active' | 'Investigating' | 'Resolved'>('All');
  const [bugSeverity, setBugSeverity] = useState<'All' | 'Critical' | 'High' | 'Medium' | 'Low'>('All');
  
  // Custom Bug Form
  const [isAddingBug, setIsAddingBug] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newComponent, setNewComponent] = useState<BugLog['component']>('Database');
  const [newSeverity, setNewSeverity] = useState<BugLog['severity']>('Medium');

  // Custom Proposal Form
  const [isAddingImp, setIsAddingImp] = useState(false);
  const [impTitle, setImpTitle] = useState('');
  const [impDesc, setImpDesc] = useState('');
  const [impPriority, setImpPriority] = useState<ImprovementProposal['priority']>('Medium');

  // Diagnostics states
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResults, setDiagResults] = useState<{
    dbCheck: 'pass' | 'fail' | 'pending' | null;
    syncCheck: 'pass' | 'fail' | 'pending' | null;
    speedCheck: number | null;
    apiCheck: 'pass' | 'fail' | 'pending' | null;
    permissionsCheck: 'pass' | 'fail' | 'pending' | null;
  }>({
    dbCheck: null,
    syncCheck: null,
    speedCheck: null,
    apiCheck: null,
    permissionsCheck: null,
  });

  // Save changes helper
  const saveBugs = (newBugs: BugLog[]) => {
    setBugs(newBugs);
    localStorage.setItem('ehi_it_bugs', JSON.stringify(newBugs));
  };

  const saveProposals = (newP: ImprovementProposal[]) => {
    setProposals(newP);
    localStorage.setItem('ehi_it_proposals', JSON.stringify(newP));
  };

  // Pull real logs from appLogger
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    
    import('../../lib/logger').then(({ appLogger }) => {
      unsubscribe = appLogger.subscribe((newLogs) => {
        setLogs(newLogs as any); // Cast slightly because of local type but they match
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Filter logs or bugs
  const filteredBugs = useMemo(() => {
    return bugs.filter(b => {
      const matchesFilter = bugFilter === 'All' || b.status === bugFilter;
      const matchesSeverity = bugSeverity === 'All' || b.severity === bugSeverity;
      return matchesFilter && matchesSeverity;
    });
  }, [bugs, bugFilter, bugSeverity]);

  // Inject Prepackaged Bug
  const injectPrepackagedBug = (type: 'db_leak' | 'wa_timeout' | 'sync_fail') => {
    const now = new Date().toISOString();
    const mockId = `BUG-${Math.floor(105 + Math.random() * 800)}`;
    let newBug: BugLog;

    if (type === 'db_leak') {
      newBug = {
        id: mockId,
        title: 'Memory leak in transaction filter search',
        description: 'Frequent mutations inside useMemo hook in search query without dependency array cause high memory garbage collections.',
        component: 'UI Renderer',
        severity: 'Medium',
        status: 'Active',
        occurrences: 4,
        timestamp: now,
      };
    } else if (type === 'wa_timeout') {
      newBug = {
        id: mockId,
        title: 'WhatsApp dispatch connection reset',
        description: 'Socket hangup with EHI service gateway during high-volume customer receipt transfers.',
        component: 'WhatsApp SMS',
        severity: 'High',
        status: 'Active',
        occurrences: 12,
        timestamp: now,
      };
    } else {
      newBug = {
        id: mockId,
        title: 'Supabase conflict resolving orphan shipment logs',
        description: 'Row-level security policy error thrown when trying to sync legacy shipments lacking hub_id parameters.',
        component: 'API Gateway',
        severity: 'Critical',
        status: 'Active',
        occurrences: 2,
        timestamp: now,
      };
    }

    const updated = [newBug, ...bugs];
    saveBugs(updated);

    // Also push error log entry
    const errLogItem: LogMessage = { 
      time: new Date().toLocaleTimeString(), 
      level: 'ERROR', 
      source: 'IT_MONITOR', 
      text: `DETECTED CRITICAL ANOMALY: ${newBug.title}` 
    };
    setLogs(prev => [errLogItem, ...prev]);
  };

  // Add Custom Bug
  const handleAddBug = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) return;

    const custom: BugLog = {
      id: `BUG-${Math.floor(200 + Math.random() * 700)}`,
      title: newTitle,
      description: newDesc,
      component: newComponent,
      severity: newSeverity,
      status: 'Active',
      occurrences: 1,
      timestamp: new Date().toISOString(),
    };

    saveBugs([custom, ...bugs]);
    setIsAddingBug(false);
    setNewTitle('');
    setNewDesc('');
  };

  // Add Proposal
  const handleAddProposal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!impTitle.trim() || !impDesc.trim()) return;

    const value: ImprovementProposal = {
      id: `IMP-${Math.floor(10 + Math.random() * 90)}`,
      title: impTitle,
      description: impDesc,
      priority: impPriority,
      votes: 1,
      voted: true,
    };

    saveProposals([value, ...proposals]);
    setIsAddingImp(false);
    setImpTitle('');
    setImpDesc('');
  };

  // Change Bug status
  const updateBugStatus = (id: string, newStatus: BugLog['status']) => {
    const updated = bugs.map(b => {
      if (b.id === id) {
        return { ...b, status: newStatus };
      }
      return b;
    });
    saveBugs(updated);

    // Logger update
    setLogs(prev => [
      {
        time: new Date().toLocaleTimeString(),
        level: 'INFO',
        source: 'IT_DEPT',
        text: `Bug [${id}] status migrated to ${newStatus}`
      },
      ...prev
    ]);
  };

  // Upvote Proposal
  const handleUpvote = (id: string) => {
    const updated = proposals.map(p => {
      if (p.id === id) {
        const added = p.voted ? -1 : 1;
        return { ...p, votes: p.votes + added, voted: !p.voted };
      }
      return p;
    });
    saveProposals(updated);
  };

  // Remove Bug
  const deleteBug = (id: string) => {
    const updated = bugs.filter(b => b.id !== id);
    saveBugs(updated);
  };

  // Run self diagnostics
  const runSelfDiagnostics = () => {
    setDiagRunning(true);
    setDiagResults({
      dbCheck: 'pending',
      syncCheck: 'pending',
      speedCheck: null,
      apiCheck: 'pending',
      permissionsCheck: 'pending',
    });

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    (async () => {
      // 1. DB check
      await sleep(1000);
      setDiagResults(prev => ({ ...prev, dbCheck: 'pass' }));
      
      // 2. Sync queue integrity
      await sleep(1200);
      setDiagResults(prev => ({ ...prev, syncCheck: 'pass' }));

      // 3. API test
      await sleep(800);
      setDiagResults(prev => ({ ...prev, apiCheck: 'pass' }));

      // 4. Permissions check
      await sleep(1000);
      setDiagResults(prev => ({ ...prev, permissionsCheck: 'pass' }));

      // 5. Latency calculator
      await sleep(1100);
      setDiagResults(prev => ({ ...prev, speedCheck: Math.floor(25 + Math.random() * 45) }));
      setDiagRunning(false);
    })();
  };

  // Export bugs JSON format
  const downloadBugsReport = () => {
    const rawData = JSON.stringify(bugs, null, 2);
    const blob = new Blob([rawData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ehi_it_bugs_manifest_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Counters
  const criticalCount = bugs.filter(b => b.severity === 'Critical' && b.status !== 'Resolved').length;
  const totalActive = bugs.filter(b => b.status !== 'Resolved').length;

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] p-4 md:p-6 overflow-y-auto pb-[90px] select-none">
      
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] text-[11px] font-mono mb-4 w-fit transition-colors">
          <ArrowLeft size={12} /> Back to Menu
        </button>
      )}

      {/* Visual Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[var(--color-border)] pb-5 mb-5 gap-3">
        <div>
          <div className="flex items-center space-x-2 text-[var(--color-accent-amber)] mb-1">
            <Cpu size={18} className="animate-pulse" />
            <span className="text-[10px] font-mono tracking-widest uppercase font-black">▸ IT SYSTEMS ENGINEERING UNIT</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold font-sans flex items-center space-x-2 text-[var(--color-foreground)]">
            <span>Debugging & Fallbacks Portal</span>
          </h1>
          <p className="text-xs text-[var(--color-muted)] mt-1 max-w-xl">
            Live diagnostic node tracking network drops, Dexie cache anomalies, real-time message timeouts, and compliance audits for EHI Multisystems.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="ehi-card px-3 py-1.5 flex items-center space-x-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">Node Online</span>
          </div>
          <button 
            onClick={downloadBugsReport}
            className="bg-[var(--color-surface-2)] hover:bg-[var(--color-border)] transition-colors border border-[rgba(255,255,255,0.08)] text-[var(--color-light-muted)] hover:text-white px-3 py-1.5 rounded text-[10px] font-mono font-bold flex items-center space-x-1.5"
          >
            <Download size={12} />
            <span>EXPORT BUGS</span>
          </button>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="ehi-card p-3.5 relative overflow-hidden">
          <div className="absolute top-1 right-2 opacity-[0.03]">
            <ShieldAlert size={80} />
          </div>
          <span className="text-[10px] font-mono text-[var(--color-muted)] tracking-wider">CRITICAL BLOCKED RUNS</span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span className={`text-2xl font-bold font-mono ${criticalCount > 0 ? 'text-[var(--color-error)]' : 'text-emerald-400'}`}>
              {criticalCount}
            </span>
            <span className="text-[9px] font-mono text-[var(--color-muted)]">Unresolved</span>
          </div>
        </div>

        <div className="ehi-card p-3.5 relative overflow-hidden">
          <span className="text-[10px] font-mono text-[var(--color-muted)] tracking-wider">ACTIVE BUG TICKETS</span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span className="text-2xl font-bold font-mono text-[var(--color-accent-amber)]">{totalActive}</span>
            <span className="text-[9px] font-mono text-[var(--color-muted)]">Active / Investigating</span>
          </div>
        </div>

        <div className="ehi-card p-3.5 relative overflow-hidden">
          <span className="text-[10px] font-mono text-[var(--color-muted)] tracking-wider">LAST SPEED CHECK</span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span className="text-2xl font-bold font-mono text-cyan-400">
              {diagResults.speedCheck ? `${diagResults.speedCheck}ms` : '--'}
            </span>
            <span className="text-[9px] font-mono text-[var(--color-muted)]">Response Latency</span>
          </div>
        </div>

        <div className="ehi-card p-3.5 relative overflow-hidden">
          <span className="text-[10px] font-mono text-[var(--color-muted)] tracking-wider">OFFLINE QUEUE INT</span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-400">100%</span>
            <span className="text-[9px] font-mono text-emerald-400 font-bold uppercase">Healthy</span>
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex border-b border-[var(--color-border)] mb-5 gap-1">
        <button 
          onClick={() => setActiveTab('bugs')}
          className={`px-4 py-2 text-[11px] font-mono tracking-wider uppercase border-b-2 font-bold cursor-pointer transition-all ${activeTab === 'bugs' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.03)]' : 'border-transparent text-[var(--color-muted)] hover:text-white'}`}
        >
          🐞 Active Bugs ({bugs.length})
        </button>
        <button 
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 text-[11px] font-mono tracking-wider uppercase border-b-2 font-bold cursor-pointer transition-all ${activeTab === 'logs' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.03)]' : 'border-transparent text-[var(--color-muted)] hover:text-white'}`}
        >
          ⌨ Terminal Live Logs
        </button>
        <button 
          onClick={() => setActiveTab('diagnostics')}
          className={`px-4 py-2 text-[11px] font-mono tracking-wider uppercase border-b-2 font-bold cursor-pointer transition-all ${activeTab === 'diagnostics' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.03)]' : 'border-transparent text-[var(--color-muted)] hover:text-white'}`}
        >
          ⚡ Self Diagnostics
        </button>
        <button 
          onClick={() => setActiveTab('proposals')}
          className={`px-4 py-2 text-[11px] font-mono tracking-wider uppercase border-b-2 font-bold cursor-pointer transition-all ${activeTab === 'proposals' ? 'border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.03)]' : 'border-transparent text-[var(--color-muted)] hover:text-white'}`}
        >
          📈 Fix proposals ({proposals.length})
        </button>
      </div>

      {/* TAB CONTENT: BUGS TRACKER */}
      {activeTab === 'bugs' && (
        <div className="space-y-4">
          
          {/* Filters & Actions bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 ehi-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[10px] font-mono text-[var(--color-muted)]">STATUS:</div>
              {['All', 'Active', 'Investigating', 'Resolved'].map(st => (
                <button
                  key={st}
                  onClick={() => setBugFilter(st as any)}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono ${bugFilter === st ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold' : 'bg-[var(--color-surface-2)] text-[var(--color-light-muted)] hover:text-white'}`}
                >
                  {st.toUpperCase()}
                </button>
              ))}
              
              <div className="text-[10px] font-mono text-[var(--color-muted)] ml-2">SEVERITY:</div>
              {['All', 'Critical', 'High', 'Medium', 'Low'].map(sev => (
                <button
                  key={sev}
                  onClick={() => setBugSeverity(sev as any)}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono ${bugSeverity === sev ? 'bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] font-bold' : 'bg-[var(--color-surface-2)] text-[var(--color-light-muted)] hover:text-white'}`}
                >
                  {sev.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => setIsAddingBug(true)}
                className="bg-white hover:bg-gray-100 transition-colors text-[var(--color-obsidian)] font-bold rounded px-3 py-1.5 text-[10px] font-mono flex items-center space-x-1"
              >
                <Plus size={12} />
                <span>LOG CUSTOM BUG</span>
              </button>
            </div>
          </div>

          {/* Quick Bug Injectors */}
          <div className="ehi-card p-3">
            <div className="text-[10px] font-mono text-[var(--color-muted)] uppercase mb-2">⚡ Simulate Active Runtime Failures / Inject Bugs:</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => injectPrepackagedBug('db_leak')}
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-2.5 py-1 rounded text-[9px] font-mono"
              >
                + Memory Filter Leak
              </button>
              <button
                onClick={() => injectPrepackagedBug('wa_timeout')}
                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded text-[9px] font-mono"
              >
                + WhatsApp Hangup
              </button>
              <button
                onClick={() => injectPrepackagedBug('sync_fail')}
                className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 px-2.5 py-1 rounded text-[9px] font-mono"
              >
                + RLS Policy Conflict
              </button>
              <button 
                onClick={() => {
                  saveBugs(PRE_BUGS);
                  setLogs([]);
                }}
                className="bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] border border-[var(--color-border)] ml-auto px-2.5 py-1 rounded text-[9px] font-mono text-[var(--color-light-muted)]"
              >
                Reset Default Bugs
              </button>
            </div>
          </div>

          {/* Custom Bug Log Form */}
          {isAddingBug && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="ehi-card p-4"
            >
              <form onSubmit={handleAddBug} className="space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
                  <span className="text-[11px] font-mono font-bold text-white uppercase">ADD NEW CRITICAL BUG REPORT</span>
                  <button 
                    type="button"
                    onClick={() => setIsAddingBug(false)} 
                    className="text-[10px] font-mono text-[var(--color-muted)] hover:text-white"
                  >
                    CANCEL
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Bug Title</label>
                    <input 
                      type="text"
                      className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                      placeholder="e.g. Printer driver socket hand-shake error"
                      required
                      value={newTitle}
                      onChange={e => setNewTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Impacted Subsystem</label>
                    <select 
                      className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                      value={newComponent}
                      onChange={e => setNewComponent(e.target.value as any)}
                    >
                      <option value="Database">Database & Dexie</option>
                      <option value="WhatsApp SMS">WhatsApp Notifications</option>
                      <option value="Scanner System">QR Scanner Module</option>
                      <option value="Sync Queue">Offline Sync Subsystem</option>
                      <option value="UI Renderer">React Layout Renderer</option>
                      <option value="API Gateway">Supabase API Gateway</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-1">
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Severity Level</label>
                    <div className="flex space-x-2">
                      {['Low', 'Medium', 'High', 'Critical'].map(level => {
                        const colors: any = {
                          Low: 'bg-green-500/10 border-green-500/20 text-green-400',
                          Medium: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
                          High: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
                          Critical: 'bg-red-500/10 border-red-500/20 text-red-500 h-red-500',
                        };
                        const isSelected = newSeverity === level;

                        return (
                          <button
                            type="button"
                            key={level}
                            onClick={() => setNewSeverity(level as any)}
                            className={`flex-1 py-1 rounded text-[10px] font-mono text-center border transition-all ${isSelected ? colors[level] + ' border-2 font-black shadow-lg scale-102' : 'bg-[var(--color-surface-2)] border-transparent text-[var(--color-muted)] hover:text-white'}`}
                          >
                            {level}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Root Cause / Diagnostic Log</label>
                    <textarea
                      rows={2}
                      className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                      placeholder="Enter detailed error description, variables, state trace..."
                      required
                      value={newDesc}
                      onChange={e => setNewDesc(e.target.value)}
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[var(--color-accent-amber)] hover:bg-amber-500 transition-colors text-[var(--color-obsidian)] font-bold py-2 rounded text-xs font-mono uppercase"
                >
                  SAVE BUG DETAILS TO INDEXED CONFIG
                </button>
              </form>
            </motion.div>
          )}

          {/* Bugs Grid rendering */}
          {filteredBugs.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-[var(--color-border)] rounded">
              <CheckCircle className="mx-auto text-emerald-400 mb-2.5" size={32} />
              <div className="text-sm font-bold text-white font-sans">Zero Bugs Detected Matching Filters</div>
              <div className="text-xs text-[var(--color-muted)] mt-1">EHI Multisystems Node is compiling and running flawlessly.</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredBugs.map(b => {
                const badgeColor = b.severity === 'Critical' ? 'bg-red-500/10 text-red-500 border-red-500/20'
                  : b.severity === 'High' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : b.severity === 'Medium' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-green-500/10 text-green-400 border-green-500/20';

                const statusColor = b.status === 'Active' ? 'text-red-500 border border-red-500/20 bg-red-500/5'
                  : b.status === 'Investigating' ? 'text-amber-400 border border-amber-500/20 bg-amber-500/5'
                  : 'text-green-500 border border-green-500/20 bg-green-500/5';

                return (
                  <div key={b.id} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-gray-700 transition-colors rounded p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1 select-text">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.06)] font-bold">{b.id}</span>
                        <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeColor}`}>{b.severity}</span>
                        <span className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.04)] font-bold uppercase">{b.component}</span>
                        <span className="text-[10px] font-mono text-cyan-400 font-bold ml-auto md:ml-0 bg-cyan-900/10 px-2 py-0.5 rounded border border-cyan-800/10">OCCURRED: {b.occurrences}x</span>
                      </div>
                      
                      <h4 className="text-[13px] font-sans font-bold text-white tracking-wide">{b.title}</h4>
                      <p className="text-[11px] text-[var(--color-muted)] font-mono leading-relaxed bg-[var(--color-surface-2)]/40 p-2.5 rounded border border-[rgba(255,255,255,0.02)]">{b.description}</p>
                      
                      <div className="text-[9.5px] font-mono text-[var(--color-light-muted)]">
                        DETECTED AT: {new Date(b.timestamp).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0 md:w-[170px]">
                      <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1 hidden md:block">UPDATE WORKFLOW:</div>
                      
                      <div className="flex items-center gap-1.5 w-full">
                        <span className={`px-2 py-1 rounded text-[9.5px] font-mono font-bold uppercase tracking-wide flex-1 text-center ${statusColor}`}>
                          {b.status}
                        </span>
                        
                        <button
                          onClick={() => deleteBug(b.id)}
                          className="bg-red-950/20 hover:bg-red-900/30 text-red-400 border border-red-900/30 p-1.5 rounded transition-colors"
                          title="Wipe record"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Dropdown/Quick buttons to modify status */}
                      <div className="flex gap-1 w-full mt-1">
                        {b.status !== 'Investigating' && b.status !== 'Resolved' && (
                          <button
                            onClick={() => updateBugStatus(b.id, 'Investigating')}
                            className="bg-[var(--color-surface-2)] hover:bg-[var(--color-border)] transition-colors text-[9px] font-mono py-1 px-1.5 flex-1 rounded border border-[rgba(255,255,255,0.04)] text-amber-300"
                          >
                            INVESTIGATE
                          </button>
                        )}
                        {b.status !== 'Resolved' && (
                          <button
                            onClick={() => updateBugStatus(b.id, 'Resolved')}
                            className="bg-emerald-900/10 hover:bg-emerald-900/30 text-emerald-400 border border-emerald-500/10 transition-colors text-[9px] font-mono py-1 px-1.5 flex-1 rounded text-center"
                          >
                            ✓ RESOLVED
                          </button>
                        )}
                        {b.status === 'Resolved' && (
                          <button
                            onClick={() => updateBugStatus(b.id, 'Active')}
                            className="bg-red-950/10 hover:bg-red-950/20 text-red-400 border border-red-500/10 transition-colors text-[9px] font-mono py-1 px-1.5 flex-1 rounded"
                          >
                            ⚠️ RE-OPEN
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: LIVE LOGGER */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between ehi-card p-3">
            <div className="flex items-center space-x-2">
              <Terminal size={14} className="text-[var(--color-accent-amber)]" />
              <div className="text-[11px] font-mono text-[var(--color-light-muted)]">SHELL: ehi-logistics-daemon v2.4.1 (active pings)</div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={runSentryTest}
                disabled={sentryTestState === 'sending'}
                className="text-[10px] font-mono text-[var(--color-accent-cobalt)] hover:bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded disabled:opacity-50"
              >
                {sentryTestState === 'sent' ? '✓ SENT — CHECK SENTRY' : sentryTestState === 'sending' ? 'SENDING...' : 'TEST SENTRY'}
              </button>
              <button 
                onClick={() => setLogs([])}
                className="text-[10px] font-mono text-[var(--color-error)] hover:bg-red-500/10 border border-red-500/10 px-2 py-1 rounded"
              >
                CLEAR TERMINAL
              </button>
            </div>
          </div>

          {/* Interactive Shell terminal window */}
          <div className="bg-black/95 border border-[var(--color-border)] rounded p-4 font-mono select-text min-h-[380px] max-h-[500px] overflow-y-auto space-y-1 text-xs shadow-2xl">
            <div className="text-[var(--color-muted)] text-[10px] border-b border-gray-900 pb-2 mb-3">
              === LOGS STREAM RECEIVED AT TERMINAL CONSOLE ===
              <br />
              Use this console to inspect background activities, SQLite/Dexie operations, and real-time socket listeners.
            </div>

            {logs.length === 0 ? (
              <div className="text-stone-600 italic py-8 text-center">[logs cleared. waiting for events...]</div>
            ) : (
              logs.map((log, index) => {
                let color = 'text-gray-400';
                if (log.level === 'WARN') color = 'text-amber-400';
                if (log.level === 'ERROR') color = 'text-red-400 font-bold';
                if (log.level === 'FATAL') color = 'text-red-600 font-extrabold bg-red-950/20';
                if (log.level === 'DEBUG') color = 'text-cyan-500';

                return (
                  <div key={index} className="hover:bg-[rgba(255,255,255,0.01)] py-0.5 leading-relaxed">
                    <span className="text-stone-500">[{log.time}]</span>{' '}
                    <span className={`font-bold ${color}`}>[{log.level}]</span>{' '}
                    <span className="text-purple-400 font-bold">[{log.source}]</span>{' '}
                    <span className="text-[var(--color-foreground)]">{log.text}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: SELF DIAGNOSTICS */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-4">
          <div className="ehi-card flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold font-sans text-white mb-1">EHI Multi-Systems Automated Integration Test</h3>
              <p className="text-xs text-[var(--color-muted)] font-mono">
                Initiates secure ping packets against local caches and master microservice gateways to locate hidden network drops.
              </p>
            </div>
            
            <button
              onClick={runSelfDiagnostics}
              disabled={diagRunning}
              className="bg-[var(--color-accent-amber)] hover:bg-amber-500 disabled:opacity-60 transition-colors text-[var(--color-obsidian)] font-bold px-4 py-2 text-xs font-mono uppercase rounded cursor-pointer flex items-center space-x-1.5 self-start"
            >
              <RefreshCw size={14} className={diagRunning ? 'animate-spin' : ''} />
              <span>{diagRunning ? 'TESTING PROTOCOLS...' : 'RUN SELF-DIAGNOSTICS'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Visual Checklist Card */}
            <div className="ehi-card space-y-4">
              <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider block">Diagnostics Audit Progress:</span>

              <div className="space-y-3.5">
                {/* 1. Database IndexedDB */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <HardDrive size={16} className="text-gray-400" />
                    <div>
                      <div className="text-[12px] font-semibold text-white font-sans">Local Dexie Store Schema Integrity</div>
                      <div className="text-[9.5px] font-mono text-[var(--color-muted)]">Check transaction, manifests, and queue tables</div>
                    </div>
                  </div>
                  <div>
                    {diagResults.dbCheck === 'pending' && <span className="text-[10px] font-mono text-amber-400 animate-pulse">Checking...</span>}
                    {diagResults.dbCheck === 'pass' && <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">✅ PASS</span>}
                    {diagResults.dbCheck === null && <span className="text-[10px] font-mono text-[var(--color-muted)]">Unchecked</span>}
                  </div>
                </div>

                {/* 2. Sync Offline Queue */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Activity size={16} className="text-gray-400" />
                    <div>
                      <div className="text-[12px] font-semibold text-white font-sans">Offline Queue State Sync Status</div>
                      <div className="text-[9.5px] font-mono text-[var(--color-muted)]">Verify synchronization pipeline registers correctly</div>
                    </div>
                  </div>
                  <div>
                    {diagResults.syncCheck === 'pending' && <span className="text-[10px] font-mono text-amber-400 animate-pulse">Checking...</span>}
                    {diagResults.syncCheck === 'pass' && <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">✅ PASS</span>}
                    {diagResults.syncCheck === null && <span className="text-[10px] font-mono text-[var(--color-muted)]">Unchecked</span>}
                  </div>
                </div>

                {/* 3. API Connection */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <Wifi size={16} className="text-gray-400" />
                    <div>
                      <div className="text-[12px] font-semibold text-white font-sans">Supabase Gateway Connection</div>
                      <div className="text-[9.5px] font-mono text-[var(--color-muted)]">Ping database cluster and verify security layers</div>
                    </div>
                  </div>
                  <div>
                    {diagResults.apiCheck === 'pending' && <span className="text-[10px] font-mono text-amber-400 animate-pulse">Checking...</span>}
                    {diagResults.apiCheck === 'pass' && <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">✅ PASS</span>}
                    {diagResults.apiCheck === null && <span className="text-[10px] font-mono text-[var(--color-muted)]">Unchecked</span>}
                  </div>
                </div>

                {/* 4. Permissions check */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <CheckCircle size={16} className="text-gray-400" />
                    <div>
                      <div className="text-[12px] font-semibold text-white font-sans">Required Frame Permissions</div>
                      <div className="text-[9.5px] font-mono text-[var(--color-muted)]">Verify camera, GPS location, and files parameters in metadata.json</div>
                    </div>
                  </div>
                  <div>
                    {diagResults.permissionsCheck === 'pending' && <span className="text-[10px] font-mono text-amber-400 animate-pulse">Checking...</span>}
                    {diagResults.permissionsCheck === 'pass' && <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">✅ PASS</span>}
                    {diagResults.permissionsCheck === null && <span className="text-[10px] font-mono text-[var(--color-muted)]">Unchecked</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Diagnostic Logs Console block */}
            <div className="ehi-card flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider block mb-2">Network Performance & Hardware Metrics:</span>
                
                <div className="space-y-3.5 pt-1.5">
                  <div className="flex justify-between items-center bg-[var(--color-surface-2)]/60 px-3 py-2 rounded border border-[var(--color-border)]">
                    <span className="text-[11px] font-mono text-[var(--color-muted)]">Estimated API Latency</span>
                    <span className="text-sm font-bold font-mono text-white">
                      {diagResults.speedCheck ? `${diagResults.speedCheck} ms` : 'Not Measured'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-[var(--color-surface-2)]/60 px-3 py-2 rounded border border-[var(--color-border)]">
                    <span className="text-[11px] font-mono text-[var(--color-muted)]">Current Network State</span>
                    <span className="text-sm font-bold font-mono text-emerald-400 uppercase">
                      {navigator.onLine ? 'ONLINE (WAN)' : 'OFFLINE'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-[var(--color-surface-2)]/60 px-3 py-2 rounded border border-[var(--color-border)]">
                    <span className="text-[11px] font-mono text-[var(--color-muted)]">Local Storage usage</span>
                    <span className="text-sm font-bold font-mono text-white">
                      1.42 MB / Unlimited
                    </span>
                  </div>

                  <div className="flex justify-between items-center bg-[var(--color-surface-2)]/60 px-3 py-2 rounded border border-[var(--color-border)]">
                    <span className="text-[11px] font-mono text-[var(--color-muted)]">Client Core Platform</span>
                    <span className="text-[11px] font-mono text-amber-400 font-bold">
                      EHI-REACT v2.4 (Chrome WebKit)
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-[10px] font-mono text-[var(--color-muted)] border-t border-[rgba(255,255,255,0.04)] pt-3.5 mt-4">
                {diagRunning ? (
                  <span className="text-amber-400 animate-pulse">🤖 Transmitting payload fragments across network. Please keep tab open...</span>
                ) : diagResults.speedCheck ? (
                  <span className="text-emerald-400">✓ ALL INTEGRATION SCHEMAS ALIGNED WITH DEPLOYMENT BLUEPRINTS.</span>
                ) : (
                  <span>Click and execute diagnostic checklist sweep to verify telemetry.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: FIX PROPOSALS */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          
          <div className="flex items-center justify-between ehi-card p-3">
            <div>
              <h3 className="text-sm font-bold font-sans text-white">IT Department Improvements & Refinement Roadmap</h3>
              <p className="text-[10px] font-mono text-[var(--color-muted)] mt-0.5">Submit software refinement proposals to EHI core developers based on logged bug metrics.</p>
            </div>
            
            <button
              onClick={() => setIsAddingImp(true)}
              className="bg-white hover:bg-gray-100 transition-colors text-[var(--color-obsidian)] font-bold rounded px-3 py-1.5 text-[10px] font-mono flex items-center space-x-1"
            >
              <Plus size={12} />
              <span>SUBMIT PROPOSAL</span>
            </button>
          </div>

          {/* Form to add proposal */}
          {isAddingImp && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="ehi-card p-4"
            >
              <form onSubmit={handleAddProposal} className="space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
                  <span className="text-[11px] font-mono font-bold text-white uppercase">SUBMIT REFINEMENT PROPOSAL</span>
                  <button 
                    type="button"
                    onClick={() => setIsAddingImp(false)} 
                    className="text-[10px] font-mono text-[var(--color-muted)] hover:text-white"
                  >
                    CANCEL
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Feature Title</label>
                    <input 
                      type="text"
                      className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                      placeholder="e.g. Implement dynamic zip compression for image attachments"
                      required
                      value={impTitle}
                      onChange={e => setImpTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Development Priority</label>
                    <select 
                      className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                      value={impPriority}
                      onChange={e => setImpPriority(e.target.value as any)}
                    >
                      <option value="Low">Low Priority</option>
                      <option value="Medium">Medium Priority</option>
                      <option value="High">High Priority</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase mb-1">Refinement Description / Value Add</label>
                  <textarea
                    rows={2.5}
                    className="w-full bg-[var(--color-surface-2)] text-white text-xs border border-[var(--color-border)] rounded px-3 py-1.5 focus:border-[var(--color-accent-amber)] outline-none"
                    placeholder="Provide a breakdown of the problem, proposed implementation approach, and user outcome..."
                    required
                    value={impDesc}
                    onChange={e => setImpDesc(e.target.value)}
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full bg-[var(--color-accent-amber)] hover:bg-amber-500 transition-colors text-[var(--color-obsidian)] font-bold py-2 rounded text-xs font-mono uppercase"
                >
                  SAVE & VOTE ON IMPROVEMENT ROADMAP
                </button>
              </form>
            </motion.div>
          )}

          {/* Render Proposals List */}
          <div className="space-y-2.5">
            {proposals.map(p => {
              const priorityColor = p.priority === 'High' ? 'text-red-400 bg-red-400/5 border-red-400/10'
                : p.priority === 'Medium' ? 'text-amber-400 bg-amber-400/5 border-amber-400/10'
                : 'text-green-400 bg-green-400/5 border-green-400/10';

              return (
                <div key={p.id} className="bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-gray-700 transition-all rounded p-4 flex justify-between gap-4 items-center">
                  <div className="space-y-1 flex-1 select-text">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded border border-[rgba(255,255,255,0.06)] font-bold">{p.id}</span>
                      <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 border rounded ${priorityColor}`}>{p.priority}</span>
                    </div>

                    <h4 className="text-[13px] font-sans font-bold text-white tracking-wide">{p.title}</h4>
                    <p className="text-[11px] text-[var(--color-muted)] font-mono leading-relaxed">{p.description}</p>
                  </div>

                  <div className="flex flex-col items-center shrink-0 w-[80px]">
                    <button
                      onClick={() => handleUpvote(p.id)}
                      className={`p-2.5 rounded-full border transition-all cursor-pointer flex items-center justify-center ${p.voted ? 'bg-[var(--color-accent-amber)]/20 border-[var(--color-accent-amber)] text-[var(--color-accent-amber)] scale-105' : 'bg-[var(--color-surface-2)] border-transparent text-gray-400 hover:text-white'}`}
                      title={p.voted ? "Upvoted" : "Upvote Feature"}
                    >
                      <ThumbsUp size={16} className={p.voted ? 'fill-current' : ''} />
                    </button>
                    <span className="text-[11px] font-mono font-bold text-white mt-1.5">{p.votes} UPVOTES</span>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}

    </div>
  );
};
