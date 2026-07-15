import { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, Search, Edit2, UserX, UserCheck,
  MapPin, Phone, Mail, Loader, AlertTriangle, Check, Eye, EyeOff, Shield, Upload, Printer
} from 'lucide-react';
import { BackButton } from '../BackButton';
import { User, UserRole } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { createStaffAccount, updateStaffProfile } from '../../lib/auth';
import { BulkStaffImport } from './BulkStaffImport';
import { getAllViewDefs, getRoleDefaultTabs, groupViewDefs } from '../../lib/permissions';

interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: string;
  hub_id: string;
  hub_type: string;
  active: boolean;
  phone?: string;
  can_print_ledger?: boolean;
  assigned_airline?: string | null;
  view_overrides?: string[] | null;
  hub?: { name: string; code: string };
}

interface Hub { id: string; name: string; code: string; state: string; }

const ROLES = [
  { value: 'cargo_agent',      label: 'Cargo Agent',      desc: 'Log cargo entries, view own hub' },
  { value: 'baggage_agent',    label: 'Baggage POS',      desc: 'Excess baggage at terminal counter' },
  { value: 'marketing_agent',  label: 'Marketing Agent',  desc: 'Field marketing entries' },
  { value: 'office_work',      label: 'Office Work',      desc: 'Only cargo and marketing view' },
  { value: 'driver',           label: 'Driver',           desc: 'Trip tracking and delivery logs' },
  { value: 'accountant',       label: 'Accountant',       desc: 'Financial reports, all hubs read access' },
  { value: 'auditor',          label: 'Auditor',          desc: 'Read-only audit trail access' },
  { value: 'admin',            label: 'Hub Admin',        desc: 'Manage own hub and staff' },
  { value: 'super_admin',      label: 'Super Admin',      desc: 'Full system access — all hubs' },
];

const roleColor = (role: string) => ({
  super_admin:     'text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.12)]',
  admin:           'text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.12)]',
  cargo_agent:     'text-[var(--color-success)] bg-[rgba(16,185,129,0.12)]',
  baggage_agent:   'text-[var(--color-purple)] bg-[rgba(168,85,247,0.12)]',
  accountant:      'text-teal-400 bg-[rgba(20,184,166,0.12)]',
  auditor:         'text-orange-400 bg-[rgba(249,115,22,0.12)]',
  driver:          'text-[var(--color-muted)] bg-[rgba(100,116,139,0.12)]',
  marketing_agent: 'text-[var(--color-success)] bg-[rgba(16,185,129,0.10)]',
  office_work:     'text-blue-400 bg-[rgba(96,165,250,0.10)]',
}[role] || 'text-[var(--color-muted)] bg-[var(--color-surface-2)]');

export const StaffManagement = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const [staff, setStaff]       = useState<StaffMember[]>([]);
  const [hubs, setHubs]         = useState<Hub[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [filterHub, setFilterHub] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [credModal, setCredModal] = useState<{ email: string; password: string } | null>(null);

  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'cargo_agent',
    hub_id: '', hub_type: 'Cargo Station', phone: '', assigned_airline: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [airlines, setAirlines] = useState<{ name: string }[]>([]);

  useEffect(() => {
    supabase.from('excess_baggage_airlines').select('name').eq('active', true).order('created_at', { ascending: true })
      .then(({ data, error }) => { if (data && !error) setAirlines(data); });
  }, []);

  const isSuperAdmin = user.role === 'super_admin';
  const isAdmin      = user.role === 'admin' || isSuperAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: hubData } = await supabase
        .from('hubs').select('id, name, code, state').order('name');
      if (hubData) setHubs(hubData as Hub[]);

      let q = supabase.from('user_profiles')
        .select('id, email, name, role, hub_id, hub_type, active, phone, can_print_ledger, assigned_airline, view_overrides, hubs(name, code)')
        .order('name');

      if (!isSuperAdmin && user.hub_id) {
        q = q.eq('hub_id', user.hub_id) as any;
      }

      const { data: staffData, error: staffError } = await q;
      if (staffError) {
        setError(`Supabase error: ${staffError.message}`);
      } else if (staffData) {
        setStaff(staffData.map((s: any) => ({
          ...s,
          hub: Array.isArray(s.hubs) ? s.hubs[0] : s.hubs,
          can_print_ledger: s.can_print_ledger ?? false,
        })));
      } else {
         setError('Query returned no data');
      }
    } catch (err: any) {
      setError(`Failed to load staff data: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, user.hub_id]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (form.hub_id) {
      const hub = hubs.find(h => h.id === form.hub_id);
      if (hub) setForm(f => ({ ...f, hub_type: hub.code === 'HQ' ? 'Head Office' : 'Cargo Station' }));
    }
  }, [form.hub_id, hubs]);

  const handleCreate = async () => {
    setError(''); setSaving(true);
    if (!form.name || !form.email || !form.password || !form.role || !form.hub_id) {
      setError('All fields except phone are required.'); setSaving(false); return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.'); setSaving(false); return;
    }
    if (form.role === 'baggage_agent' && !form.assigned_airline) {
      setError('Select which airline this Baggage POS agent is assigned to.'); setSaving(false); return;
    }
    try {
      const tempPassword = form.password;
      await createStaffAccount(form);
      setCredModal({ email: form.email, password: tempPassword });
      setSuccess('Account created successfully for ' + form.name);
      setForm({ name:'', email:'', password:'', role:'cargo_agent', hub_id: user.hub_id||'', hub_type:'Cargo Station', phone:'', assigned_airline:'' });
      setShowCreate(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateRole = async (staffId: string, updates: any) => {
    setSaving(true); setError('');
    try {
      await updateStaffProfile(staffId, updates);
      await loadData();
      setEditingStaff(null);
      setSuccess('Profile updated.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member: StaffMember) => {
    setSaving(true); setError('');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || '';
      const res = await fetch('/api/admin/set-staff-active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: member.id, active: !member.active }),
      });
      let data: any = {};
      let rawText = '';
      try {
        rawText = await res.text();
        if (rawText) data = JSON.parse(rawText);
      } catch(e) {}

      if (!res.ok || data.error) {
        if (res.status === 503) {
          const { error } = await supabase.from('user_profiles').update({ active: !member.active }).eq('id', member.id);
          if (error) throw new Error(`Backend not configured, direct DB update failed: ${error.message}`);
        } else {
          const fallback = rawText
            ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
            : `Server returned error status ${res.status} with an empty response`;
          throw new Error(data.error || fallback);
        }
      }
      await loadData();
      setSuccess(`${member.name} ${!member.active ? 'activated' : 'deactivated'}.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = staff.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase());
    const matchHub = filterHub === 'all' || s.hub_id === filterHub;
    return matchSearch && matchHub;
  });

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
        <BackButton onClick={onBack} label="Back" />
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● STAFF MANAGEMENT</span>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-lg flex items-center gap-2 text-[12px] text-[var(--color-error)]">
          <AlertTriangle size={14} />{error}
          <button onClick={() => setError('')} aria-label="Dismiss" className="ml-auto font-mono">✕</button>
        </div>
      )}
      {success && (
        <div className="mx-4 mt-3 p-3 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.3)] rounded-lg flex items-center gap-2 text-[12px] text-[var(--color-success)]">
          <Check size={14} />{success}
          <button onClick={() => setSuccess('')} aria-label="Dismiss" className="ml-auto font-mono">✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="p-4 flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-8 ehi-input text-[12px]"
          />
        </div>
        {isSuperAdmin && (
          <select value={filterHub} onChange={e => setFilterHub(e.target.value)} className="ehi-input text-[12px]">
            <option value="all">All Hubs</option>
            {hubs.map(h => <option key={h.id} value={h.id}>{h.code} — {h.name}</option>)}
          </select>
        )}
        <button onClick={loadData} aria-label="Refresh" className="p-2 ehi-card border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent-amber)] transition-colors">
          <RefreshCw size={14} className="text-[var(--color-muted)]" />
        </button>
        {isAdmin && (
          <button onClick={() => { setShowCreate(true); setForm(f => ({ ...f, hub_id: user.hub_id || '' })); }}
            className="flex items-center gap-1.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold px-3 py-2 rounded-lg">
            <Plus size={13} /> Add Staff
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setShowBulkImport(true)}
            className="flex items-center gap-1.5 ehi-card border border-[var(--color-border)] text-[var(--color-foreground)] text-[11px] font-bold px-3 py-2 rounded-lg hover:border-[var(--color-accent-amber)] transition-colors">
            <Upload size={13} /> Bulk Import
          </button>
        )}
      </div>

      {showBulkImport && (
        <BulkStaffImport
          hubCodes={hubs.map(h => h.code)}
          onClose={() => setShowBulkImport(false)}
          onImported={loadData}
        />
      )}

      {/* Stats row */}
      <div className="px-4 pb-3 flex gap-3 shrink-0">
        {[
          { label: 'Total Staff', value: filtered.length },
          { label: 'Active',      value: filtered.filter(s => s.active).length, color: 'var(--color-success)' },
          { label: 'Inactive',    value: filtered.filter(s => !s.active).length, color: 'var(--color-error)' },
          { label: 'Hubs',        value: new Set(filtered.map(s => s.hub_id)).size, color: 'var(--color-accent-cobalt)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex-1 ehi-card p-3 rounded-xl">
            <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase">{label}</div>
            <div className="text-[16px] font-bold font-mono" style={{ color: color || 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Staff list */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 space-y-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader size={24} className="animate-spin text-[var(--color-accent-amber)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-muted)] text-[12px] font-mono">
            No staff found
          </div>
        ) : filtered.map(member => (
          <div key={member.id} className={`ehi-card p-4 rounded-xl border transition-colors ${!member.active ? 'opacity-50 border-[rgba(239,68,68,0.2)]' : 'border-[var(--color-border)]'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[13px] font-bold text-[var(--color-foreground)]">{member.name}</span>
                  <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded font-mono ${roleColor(member.role)}`}>
                    {ROLES.find(r => r.value === member.role)?.label || member.role}
                  </span>
                  {!member.active && (
                    <span className="text-[8px] font-bold uppercase px-2 py-0.5 rounded font-mono text-[var(--color-error)] bg-[rgba(239,68,68,0.12)]">
                      Inactive
                    </span>
                  )}
                  {member.can_print_ledger && (
                    <span className="text-[8px] font-bold uppercase px-2 py-0.5 rounded font-mono text-cyan-400 bg-[rgba(34,211,238,0.1)] border border-[rgba(34,211,238,0.2)]">
                      <Printer size={8} className="inline mr-1 mb-[1px]" />
                      Ledger Print
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted)] mb-1">
                  <Mail size={9} /><span>{member.email}</span>
                </div>
                {member.phone && (
                  <div className="flex items-center gap-1 text-[10px] text-[var(--color-muted)] mb-1">
                    <Phone size={9} /><span>{member.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-1 text-[10px] text-[var(--color-accent-cobalt)]">
                  <MapPin size={9} />
                  <span>{member.hub?.name || member.hub_type} · {member.hub?.code}</span>
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditingStaff(member)}
                    className="p-1.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded hover:border-[var(--color-accent-amber)] transition-colors"
                    title="Edit role / hub"
                    aria-label={`Edit ${member.name}`}
                  >
                    <Edit2 size={12} className="text-[var(--color-muted)]" />
                  </button>
                  {member.id !== user.id && (
                    <button
                      onClick={() => handleToggleActive(member)}
                      disabled={saving}
                      className={`p-1.5 border rounded transition-colors ${member.active
                        ? 'bg-[rgba(239,68,68,0.08)] border-[rgba(239,68,68,0.2)] hover:border-[var(--color-error)]'
                        : 'bg-[rgba(16,185,129,0.08)] border-[rgba(16,185,129,0.2)] hover:border-[var(--color-success)]'}`}
                      title={member.active ? 'Deactivate account' : 'Reactivate account'}
                      aria-label={member.active ? `Deactivate ${member.name}` : `Reactivate ${member.name}`}
                    >
                      {member.active
                        ? <UserX size={12} className="text-[var(--color-error)]" />
                        : <UserCheck size={12} className="text-[var(--color-success)]" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* CREATE STAFF MODAL */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="ehi-card w-full max-w-sm rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)]">
              <span className="text-[12px] font-bold text-[var(--color-foreground)]">Create Staff Account</span>
              <button onClick={() => setShowCreate(false)} aria-label="Close" className="text-[var(--color-muted)] font-mono text-lg leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh]">
              <div>
                <label htmlFor="staff-create-name" className="ehi-label">Full Name *</label>
                <input id="staff-create-name" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Chukwudi Emmanuel" className="ehi-input" />
              </div>
              <div>
                <label htmlFor="staff-create-email" className="ehi-label">Email Address *</label>
                <input id="staff-create-email" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value.toLowerCase().trim()}))} placeholder="chukwudi@ehimultisystems.com" className="ehi-input" />
              </div>
              <div>
                <label htmlFor="staff-create-password" className="ehi-label">Temporary Password *</label>
                <div className="relative">
                  <input
                    id="staff-create-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({...f, password: e.target.value}))}
                    placeholder="Min 8 characters"
                    className="ehi-input pr-10"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
                    {showPassword ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
                <p className="text-[9px] text-[var(--color-muted)] mt-1">Staff must change this after first login.</p>
              </div>
              <div>
                <label htmlFor="staff-create-role" className="ehi-label">Role *</label>
                <select id="staff-create-role" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} className="ehi-input">
                  {ROLES.filter(r => isSuperAdmin || r.value !== 'super_admin').map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
              </div>
              {form.role === 'baggage_agent' && (
                <div>
                  <label htmlFor="staff-create-airline" className="ehi-label">Assigned Airline *</label>
                  <select id="staff-create-airline" value={form.assigned_airline} onChange={e => setForm(f => ({...f, assigned_airline: e.target.value}))} className="ehi-input">
                    <option value="">Select airline...</option>
                    {airlines.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="staff-create-hub" className="ehi-label">Station / Hub *</label>
                <select id="staff-create-hub" value={form.hub_id} onChange={e => setForm(f => ({...f, hub_id: e.target.value}))} className="ehi-input">
                  <option value="">Select hub...</option>
                  {hubs
                    .filter(h => isSuperAdmin || h.id === user.hub_id)
                    .map(h => <option key={h.id} value={h.id}>{h.code} — {h.name} ({h.state})</option>)
                  }
                </select>
              </div>
              <div>
                <label htmlFor="staff-create-phone" className="ehi-label">Phone Number (optional)</label>
                <input id="staff-create-phone" name="staff-create-phone" type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="+234 800 000 0000" className="ehi-input" />
              </div>

              {error && (
                <div className="text-[11px] text-[var(--color-error)] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)] p-2 rounded">{error}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowCreate(false); setError(''); }} className="flex-1 h-11 border border-[var(--color-border)] rounded-lg text-[12px] font-bold text-[var(--color-muted)]">Cancel</button>
                <button onClick={handleCreate} disabled={saving} className="flex-1 h-11 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold disabled:opacity-60">
                  {saving ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT STAFF MODAL */}
      {editingStaff && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="ehi-card w-full max-w-sm rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)]">
              <div>
                <span className="text-[12px] font-bold text-[var(--color-foreground)]">Edit Staff Profile</span>
                <div className="text-[10px] text-[var(--color-muted)] font-mono">{editingStaff.email}</div>
              </div>
              <button onClick={() => setEditingStaff(null)} aria-label="Close" className="text-[var(--color-muted)] font-mono text-lg leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto">
              {/* Name */}
              <div>
                <label htmlFor="staff-edit-name" className="ehi-label">Full Name</label>
                <input
                  id="staff-edit-name"
                  value={editingStaff.name}
                  onChange={e => setEditingStaff(s => s ? {...s, name: e.target.value} : null)}
                  className="ehi-input"
                />
              </div>
              {/* Phone */}
              <div>
                <label htmlFor="staff-edit-phone" className="ehi-label">Phone Number</label>
                <input
                  id="staff-edit-phone"
                  name="staff-edit-phone"
                  type="tel"
                  value={editingStaff.phone || ''}
                  onChange={e => setEditingStaff(s => s ? {...s, phone: e.target.value} : null)}
                  placeholder="+234 800 000 0000"
                  className="ehi-input"
                />
              </div>
              {/* Role */}
              <div>
                <label htmlFor="staff-edit-role" className="ehi-label">Role</label>
                <select
                  id="staff-edit-role"
                  value={editingStaff.role}
                  onChange={e => setEditingStaff(s => s ? {...s, role: e.target.value} : null)}
                  className="ehi-input"
                >
                  {ROLES.filter(r => isSuperAdmin || r.value !== 'super_admin').map(r => (
                    <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                  ))}
                </select>
              </div>
              {/* Assigned Airline (baggage_agent only) */}
              {editingStaff.role === 'baggage_agent' && (
                <div>
                  <label htmlFor="staff-edit-airline" className="ehi-label">Assigned Airline</label>
                  <select
                    id="staff-edit-airline"
                    value={editingStaff.assigned_airline || ''}
                    onChange={e => setEditingStaff(s => s ? {...s, assigned_airline: e.target.value} : null)}
                    className="ehi-input"
                  >
                    <option value="">Select airline...</option>
                    {airlines.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                </div>
              )}
              {/* Hub (super_admin only) */}
              {isSuperAdmin && (
                <div>
                  <label htmlFor="staff-edit-hub" className="ehi-label">Station / Hub</label>
                  <select
                    id="staff-edit-hub"
                    value={editingStaff.hub_id}
                    onChange={e => setEditingStaff(s => s ? {...s, hub_id: e.target.value} : null)}
                    className="ehi-input"
                  >
                    {hubs.map(h => <option key={h.id} value={h.id}>{h.code} — {h.name} ({h.state})</option>)}
                  </select>
                </div>
              )}
              {/* Ledger Edit Permission — super_admin only */}
              {isSuperAdmin && (
                <>
                <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Shield size={12} className="text-[var(--color-accent-amber)]" />
                        <span className="text-[12px] font-bold text-[var(--color-foreground)]">Ledger Edit Permission</span>
                      </div>
                      <p className="text-[10px] text-[var(--color-muted)] leading-snug">
                        Allows this staff member to edit transaction entries in the ledger. Changes affect live financial data.
                      </p>
                    </div>
                    <button
                      onClick={() => setEditingStaff(s => s ? {...s, can_print_ledger: !s.can_print_ledger} : null)}
                      role="switch"
                      aria-checked={editingStaff.can_print_ledger}
                      aria-label="Ledger edit permission"
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors ml-3 ${
                        editingStaff.can_print_ledger
                          ? 'bg-[var(--color-accent-amber)] border-[var(--color-accent-amber)]'
                          : 'bg-[var(--color-surface-2)] border-[var(--color-border)]'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
                        editingStaff.can_print_ledger ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  {editingStaff.can_print_ledger && (
                    <div className="mt-2 text-[9px] font-mono text-[var(--color-accent-amber)] bg-[rgba(245,158,11,0.08)] px-2 py-1 rounded">
                      ⚠ This user can print receipts/tags from the ledger
                    </div>
                  )}
                </div>

                {/* View Access Override — master control: only super_admin
                    can edit any staff member's view access, regardless of
                    who is being edited. When off, this person's access
                    follows the normal role-based defaults. */}
                <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Eye size={12} className="text-[var(--color-accent-amber)]" />
                        <span className="text-[12px] font-bold text-[var(--color-foreground)]">Custom View Access</span>
                      </div>
                      <p className="text-[10px] text-[var(--color-muted)] leading-snug">
                        Override exactly which views this person can see, regardless of role. Off = normal role-based access.
                      </p>
                    </div>
                    <button
                      onClick={() => setEditingStaff(s => {
                        if (!s) return null;
                        if (s.view_overrides != null) return { ...s, view_overrides: null };
                        // Seed the checklist from the role's current defaults so
                        // flipping this on doesn't instantly lock the person out
                        // of every view until boxes are checked.
                        return { ...s, view_overrides: getRoleDefaultTabs({ role: s.role as UserRole, assigned_airline: s.assigned_airline || undefined }, airlines as any) };
                      })}
                      role="switch"
                      aria-checked={editingStaff.view_overrides != null}
                      aria-label="Custom view access"
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors ml-3 ${
                        editingStaff.view_overrides != null
                          ? 'bg-[var(--color-accent-amber)] border-[var(--color-accent-amber)]'
                          : 'bg-[var(--color-surface-2)] border-[var(--color-border)]'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
                        editingStaff.view_overrides != null ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                  {editingStaff.view_overrides != null && (
                    <div className="mt-3 max-h-72 overflow-y-auto pr-1 space-y-2.5">
                      {groupViewDefs(getAllViewDefs(airlines as any)).map(group => (
                        <div key={group.category}>
                          <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1 px-0.5">{group.category}</div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {group.views.map(v => {
                              const checked = editingStaff.view_overrides?.includes(v.id) ?? false;
                              return (
                                <label key={v.id} className="flex items-center gap-1.5 text-[10px] text-[var(--color-foreground)] bg-[var(--color-surface-2)] rounded px-2 py-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={e => setEditingStaff(s => {
                                      if (!s) return null;
                                      const current = s.view_overrides || [];
                                      const next = e.target.checked ? [...current, v.id] : current.filter(id => id !== v.id);
                                      return { ...s, view_overrides: next };
                                    })}
                                    className="shrink-0"
                                  />
                                  <span className="truncate">{v.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                </>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setEditingStaff(null); setError(''); }} className="flex-1 h-11 border border-[var(--color-border)] rounded-lg text-[12px] font-bold text-[var(--color-muted)]">Cancel</button>
                <button
                  onClick={() => handleUpdateRole(editingStaff.id, {
                    name: editingStaff.name,
                    phone: editingStaff.phone,
                    role: editingStaff.role,
                    hub_id: editingStaff.hub_id,
                    can_print_ledger: editingStaff.can_print_ledger,
                    assigned_airline: editingStaff.role === 'baggage_agent' ? (editingStaff.assigned_airline || null) : null,
                    ...(isSuperAdmin ? { view_overrides: editingStaff.view_overrides ?? null } : {}),
                  })}
                  disabled={saving}
                  className="flex-1 h-11 bg-[var(--color-accent-cobalt)] text-white rounded-lg text-[12px] font-bold disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {credModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-6 max-w-sm w-full">
            <div className="text-[13px] font-bold mb-4 text-[var(--color-foreground)]">New Staff Credentials — Share Once</div>
            <div className="space-y-2 mb-4">
              <div className="text-[11px] text-[var(--color-muted)] font-mono">Email</div>
              <div className="text-[13px] font-mono bg-[var(--color-surface-2)] p-2 rounded text-[var(--color-foreground)]">{credModal.email}</div>
              <div className="text-[11px] text-[var(--color-muted)] font-mono mt-2">Temporary Password</div>
              <div className="text-[20px] font-mono font-bold bg-[var(--color-surface-2)] p-2 rounded tracking-widest text-[var(--color-foreground)]">{credModal.password}</div>
            </div>
            <p className="text-[11px] text-[var(--color-muted)] mb-4">Copy and share these with the new staff member. This dialog will not appear again.</p>
            <button
              onClick={() => setCredModal(null)}
              className="w-full py-2 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] rounded-lg text-[12px] font-bold cursor-pointer"
            >
              Done — I've shared the credentials
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
