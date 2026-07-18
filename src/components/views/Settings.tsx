import { useState, useEffect } from 'react';
import { User, HubType } from '../../lib/types';
import {
  Settings as SettingsIcon,
  ToggleLeft,
  ToggleRight,
  Plus,
  MapPin,
  Plane,
  Check,
  DollarSign,
  Eye, EyeOff, Wifi, WifiOff, Phone, Mail, Building2, Key, Printer
} from 'lucide-react';
import { BackButton } from '../BackButton';
import { reinitSupabase, getConnectionMode, testSupabaseConnection, supabase } from '../../lib/supabase';
import { getConfiguredPrinter, setConfiguredPrinter, listPrinters } from '../../lib/qzPrint';
import { useToast } from '../../lib/ToastContext';
import { useAirlines } from '../../lib/airlines';

export const Settings = ({
  user,
  onBack,
  onOpenAirlineCommissions,
}: {
  user: User;
  onBack: () => void;
  onOpenAirlineCommissions?: () => void;
}) => {
  const { showToast } = useToast();

  // Connection & API panel state
  const [configTab, setConfigTab] = useState<
    'CONNECTION' | 'PAYMENTS' | 'NOTIFICATIONS' | 'COMPANY'
  >('CONNECTION');

  // Connection tab
  const [supabaseUrl, setSupabaseUrl] = useState(
    () => localStorage.getItem('ehi_supabase_url') || ''
  );
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(
    () => localStorage.getItem('ehi_supabase_anon_key') || ''
  );
  const [showAnonKey, setShowAnonKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState<
    null | { ok: boolean; error?: string }
  >(null);

  // Payments tab
  const [paystackPublicKey, setPaystackPublicKey] = useState(
    () => localStorage.getItem('ehi_paystack_public_key') || ''
  );

  // Notifications tab
  const [adminPhone, setAdminPhone] = useState(
    () => localStorage.getItem('ehi_admin_phone') || ''
  );
  const [adminEmail, setAdminEmail] = useState(
    () => localStorage.getItem('ehi_admin_email') || ''
  );

  // Company tab -- Supabase (pricing_config, config_key='company_settings')
  // is the source of truth so every device/terminal shows the same company
  // identity; localStorage is only a read-through cache for instant paint
  // while the fetch below is in flight, same pattern as the other config
  // screens (PricingConfiguration, HubCargoRates).
  const [companyName, setCompanyName] = useState(
    () => localStorage.getItem('ehi_company_name') ||
         'EHI Multisystems Nigeria Limited'
  );
  const [companyPhone, setCompanyPhone] = useState(
    () => localStorage.getItem('ehi_company_phone') || ''
  );
  const [companyAddress, setCompanyAddress] = useState(
    () => localStorage.getItem('ehi_company_address') || ''
  );
  const [savingCompany, setSavingCompany] = useState(false);

  useEffect(() => {
    supabase.from('pricing_config').select('config_value').eq('config_key', 'company_settings').single()
      .then(({ data, error }) => {
        if (!data?.config_value || error) return;
        const c = data.config_value as { name?: string; phone?: string; address?: string };
        if (c.name) setCompanyName(c.name);
        if (c.phone != null) setCompanyPhone(c.phone);
        if (c.address != null) setCompanyAddress(c.address);
        try {
          localStorage.setItem('ehi_company_name', c.name || '');
          localStorage.setItem('ehi_company_phone', c.phone || '');
          localStorage.setItem('ehi_company_address', c.address || '');
        } catch {
          // localStorage unavailable -- state above is already updated
        }
      });
  }, []);

  const connectionMode = getConnectionMode();

  const handleSaveConnection = async () => {
    localStorage.setItem('ehi_supabase_url', supabaseUrl.trim());
    localStorage.setItem('ehi_supabase_anon_key', supabaseAnonKey.trim());
    reinitSupabase();
    setTestingConn(true);
    setConnResult(null);
    const result = await testSupabaseConnection();
    setTestingConn(false);
    setConnResult(result);
  };

  const handleClearConnection = () => {
    localStorage.removeItem('ehi_supabase_url');
    localStorage.removeItem('ehi_supabase_anon_key');
    setSupabaseUrl('');
    setSupabaseAnonKey('');
    reinitSupabase();
    setConnResult(null);
  };

  const handleSavePayments = () => {
    localStorage.setItem('ehi_paystack_public_key', paystackPublicKey.trim());
  };

  const handleSaveNotifications = () => {
    localStorage.setItem('ehi_admin_phone', adminPhone.trim());
    localStorage.setItem('ehi_admin_email', adminEmail.trim());
  };

  const handleSaveCompany = async () => {
    const name = companyName.trim();
    const phone = companyPhone.trim();
    const address = companyAddress.trim();
    setSavingCompany(true);
    const { error } = await supabase.from('pricing_config').upsert({
      config_key: 'company_settings',
      config_value: { name, phone, address },
      description: 'Company identity shown on receipts and printouts',
    }, { onConflict: 'config_key' });
    setSavingCompany(false);
    if (error) {
      showToast({ message: `Failed to save company settings: ${error.message}`, type: 'error' });
      return;
    }
    localStorage.setItem('ehi_company_name', name);
    localStorage.setItem('ehi_company_phone', phone);
    localStorage.setItem('ehi_company_address', address);
    showToast({ message: 'Company settings saved.', type: 'success' });
  };

  // Option Toggles (persisted locally)
  const [notifyWhatsApp, setNotifyWhatsApp] = useState(() => {
    return localStorage.getItem('ehi_setting_notify_whatsapp') !== 'false';
  });
  const [managerPhone, setManagerPhone] = useState(() =>
    localStorage.getItem('ehi_manager_phone') || ''
  );
  const [driveSync, setDriveSync] = useState(() => {
    return localStorage.getItem('ehi_setting_drive_sync') !== 'false';
  });

  // Multi-Hub — loaded live from Supabase (single source of truth)
  const [hubs, setHubs] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('hubs').select('id, name, code, type, active, shift_start_hour').order('name').then(({ data }) => {
      if (data) {
        setHubs(data.map((h: any) => ({
          id: h.id,
          name: `${h.code}/${h.name}`,
          code: h.code,
          type: h.type,
          active: h.active,
          shift_start_hour: h.shift_start_hour ?? 18,
        })));
      }
    });
  }, []);

  // Live airline list -- same pricing_config.airline_commissions source
  // Airline Commissions itself writes to. This used to be a separate
  // localStorage-only list with an Active/Muted toggle that wrote back to
  // that same key and nowhere else -- muting a carrier here had no effect
  // anywhere else in the app.
  const airlines = useAirlines({ includeOther: false });

  // Persist edits
  useEffect(() => {
    localStorage.setItem('ehi_setting_notify_whatsapp', String(notifyWhatsApp));
  }, [notifyWhatsApp]);

  useEffect(() => {
    localStorage.setItem('ehi_manager_phone', managerPhone);
  }, [managerPhone]);

  useEffect(() => {
    localStorage.setItem('ehi_setting_drive_sync', String(driveSync));
  }, [driveSync]);

  const handleToggleHub = async (id: string) => {
    const target = hubs.find((h: any) => h.id === id);
    if (!target) return;
    const newActive = !target.active;
    const prev = hubs;
    setHubs((prevHubs: any) => prevHubs.map((h: any) => h.id === id ? { ...h, active: newActive } : h));
    const { error } = await supabase.from('hubs').update({ active: newActive }).eq('id', id);
    if (error) {
      setHubs(prev);
      showToast({ message: `Failed to update hub: ${error.message}`, type: 'error' });
    }
  };

  const handleShiftHourChange = async (id: string, hour: number) => {
    // Optimistic update for instant UI feedback
    setHubs((prevHubs: any) => prevHubs.map((h: any) => h.id === id ? { ...h, shift_start_hour: hour } : h));
    const { error } = await supabase.from('hubs').update({ shift_start_hour: hour }).eq('id', id);
    if (error) {
      showToast({ message: `Failed to save shift time: ${error.message}`, type: 'error' });
    } else {
      showToast({ message: `Shift start hour updated to ${hour}:00`, type: 'success' });
    }
  };

  // Add Hub — writes straight to Supabase (single source of truth, same as
  // the hub list itself); requires the 'Admins insert hubs' RLS policy
  // (supabase/migrations/20260802_hubs_write_policies.sql) to be applied.
  const [newHubName, setNewHubName] = useState('');
  const [newHubCode, setNewHubCode] = useState('');
  const [newHubState, setNewHubState] = useState('');
  // Values must match the live hubs.type CHECK constraint exactly
  // ('Cargo Station' | 'Head Office' | 'Field Office') -- previously used
  // 'airport'/'transit'/'depot', which never matched anything real and
  // failed every insert with a check-constraint violation.
  const [newHubType, setNewHubType] = useState<HubType>('Cargo Station');
  const [addingHub, setAddingHub] = useState(false);

  const handleAddHub = async () => {
    const name = newHubName.trim();
    const code = newHubCode.trim().toUpperCase();
    if (!name || !code) {
      showToast({ message: 'Hub name and code are required.', type: 'error' });
      return;
    }
    // Pre-check against the already-loaded list -- code has a DB UNIQUE
    // constraint (case-sensitive), so a collision without this check
    // surfaces as a raw Postgres error instead of a clear message.
    if (hubs.some((h: any) => h.code.toUpperCase() === code)) {
      showToast({ message: `Hub code "${code}" is already in use.`, type: 'error' });
      return;
    }
    setAddingHub(true);
    const { data, error } = await supabase.from('hubs')
      .insert({ name, code, state: newHubState.trim() || null, type: newHubType, active: true })
      .select('id, name, code, type, active')
      .single();
    setAddingHub(false);
    if (error) {
      showToast({ message: `Failed to add hub: ${error.message}`, type: 'error' });
      return;
    }
    setHubs((prevHubs: any) => [...prevHubs, { id: data.id, name: `${data.code}/${data.name}`, code: data.code, type: data.type, active: data.active }]);
    showToast({ message: `${code}/${name} added.`, type: 'success' });
    setNewHubName('');
    setNewHubCode('');
    setNewHubState('');
    setNewHubType('Cargo Station');
  };

  // Silent printing (QZ Tray) — per-device, so read/written straight to
  // localStorage rather than the hub/carrier state above, neither of
  // which syncs to Supabase either at the per-terminal level this needs.
  const [qzStatus, setQzStatus] = useState<'unknown' | 'checking' | 'available' | 'unavailable'>('unknown');
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [receiptPrinter, setReceiptPrinter] = useState(() => getConfiguredPrinter('receipt') || '');
  const [tagPrinter, setTagPrinter] = useState(() => getConfiguredPrinter('tag') || '');

  const handleDetectPrinters = async () => {
    setQzStatus('checking');
    try {
      const found = await listPrinters();
      setQzPrinters(found);
      setQzStatus('available');
    } catch {
      setQzPrinters([]);
      setQzStatus('unavailable');
    }
  };

  const handleReceiptPrinterChange = (name: string) => {
    setReceiptPrinter(name);
    setConfiguredPrinter('receipt', name || null);
  };

  const handleTagPrinterChange = (name: string) => {
    setTagPrinter(name);
    setConfiguredPrinter('tag', name || null);
  };

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] p-4 space-y-6 select-none font-sans">
      
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <BackButton onClick={onBack} label="Back" />
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● SYSTEM ADMIN CONSOLE</span>
      </div>

      {user.role === 'super_admin' && (
        <div className="ehi-card overflow-hidden">
          {/* Section header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <Key size={13} className="text-[var(--color-accent-amber)]" />
            <span className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-widest uppercase font-bold">
              CONNECTION & API CONFIGURATION
            </span>
          </div>

          {/* Sub-tabs — min 11px for mobile readability */}
          <div className="flex border-b border-[var(--color-border)] overflow-x-auto">
            {(['CONNECTION','PAYMENTS','NOTIFICATIONS','COMPANY'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setConfigTab(tab)}
                className="flex-1 min-w-[72px] py-3 text-[11px] font-mono tracking-wide cursor-pointer border-none bg-transparent transition-colors whitespace-nowrap px-1"
                style={{
                  color: configTab === tab
                    ? 'var(--color-accent-amber)'
                    : 'var(--color-muted)',
                  borderBottom: configTab === tab
                    ? '2px solid var(--color-accent-amber)'
                    : '2px solid transparent',
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-3">
            {/* CONNECTION TAB */}
            {configTab === 'CONNECTION' && (
              <div className="space-y-3">
                {/* Status indicator */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded text-[10px] font-mono ${
                  connectionMode === 'live'
                    ? 'bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] text-[var(--color-success)]'
                    : 'bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]'
                }`}>
                  {connectionMode === 'live'
                    ? <><Wifi size={12} /> ● CONNECTED TO SUPABASE</>
                    : <><WifiOff size={12} /> ○ NOT CONNECTED — Add Supabase credentials below</>
                  }
                </div>

                {/* URL input */}
                <div>
                  <label htmlFor="settings-supabase-url" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    id="settings-supabase-url"
                    type="text"
                    value={supabaseUrl}
                    onChange={e => setSupabaseUrl(e.target.value)}
                    placeholder="https://your-project.supabase.co"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>

                {/* Anon key input with show/hide */}
                <div>
                  <label htmlFor="settings-supabase-anon-key" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Supabase Anon Key
                  </label>
                  <div className="relative">
                    <input
                      id="settings-supabase-anon-key"
                      type={showAnonKey ? 'text' : 'password'}
                      value={supabaseAnonKey}
                      onChange={e => setSupabaseAnonKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full h-10 px-3 pr-10 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                    <button
                      onClick={() => setShowAnonKey(!showAnonKey)}
                      aria-label={showAnonKey ? 'Hide anon key' : 'Show anon key'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] cursor-pointer bg-transparent border-none"
                    >
                      {showAnonKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Connection test result */}
                {connResult && (
                  <div className={`px-3 py-2 rounded text-[10px] font-mono ${
                    connResult.ok
                      ? 'bg-[rgba(16,185,129,0.1)] text-[var(--color-success)]'
                      : 'bg-[rgba(239,68,68,0.1)] text-[var(--color-error)]'
                  }`}>
                    {connResult.ok
                      ? '✓ Connected successfully'
                      : `✗ ${connResult.error || 'Connection failed'}`}
                  </div>
                )}

                {/* Buttons */}
                <button
                  onClick={handleSaveConnection}
                  disabled={testingConn || !supabaseUrl.trim()}
                  className="w-full py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded disabled:opacity-50 cursor-pointer"
                >
                  {testingConn ? 'TESTING CONNECTION...' : 'SAVE & RECONNECT'}
                </button>

                <button
                  onClick={handleClearConnection}
                  className="w-full text-[10px] font-mono text-[var(--color-error)] bg-transparent border-none cursor-pointer py-1"
                >
                  Clear credentials
                </button>

                <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed pt-1">
                  🔒 Credentials stored in browser localStorage only.
                  Never leave this device. Secret keys (service role,
                  Paystack secret, Termii) belong in server env vars only.
                </p>
              </div>
            )}

            {/* PAYMENTS TAB */}
            {configTab === 'PAYMENTS' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="settings-paystack-key" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Paystack Public Key
                  </label>
                  <input
                    id="settings-paystack-key"
                    type="text"
                    value={paystackPublicKey}
                    onChange={e => setPaystackPublicKey(e.target.value)}
                    placeholder="pk_live_..."
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <button
                  onClick={handleSavePayments}
                  className="w-full py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded cursor-pointer"
                >
                  SAVE
                </button>
                <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed">
                  Public key is safe to store here.
                  The secret key (sk_live_...) must be set in your
                  server environment — never in the browser.
                </p>
              </div>
            )}

            {/* NOTIFICATIONS TAB */}
            {configTab === 'NOTIFICATIONS' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="settings-admin-phone" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Admin Phone (EOD SMS/WhatsApp)
                  </label>
                  <input
                    id="settings-admin-phone"
                    type="tel"
                    value={adminPhone}
                    onChange={e => setAdminPhone(e.target.value)}
                    placeholder="+2348012345678"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label htmlFor="settings-admin-email" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Admin Email (EOD Reports)
                  </label>
                  <input
                    id="settings-admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    placeholder="admin@ehimultisystems.com"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed">
                  Termii API key must be set in server env vars.
                  These contact details are used by the EOD system
                  to send daily reports automatically.
                </p>
                <button
                  onClick={handleSaveNotifications}
                  className="w-full py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded cursor-pointer"
                >
                  SAVE
                </button>
              </div>
            )}

            {/* COMPANY TAB */}
            {configTab === 'COMPANY' && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="settings-company-name" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Name
                  </label>
                  <input
                    id="settings-company-name"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label htmlFor="settings-company-phone" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Phone
                  </label>
                  <input
                    id="settings-company-phone"
                    type="tel"
                    value={companyPhone}
                    onChange={e => setCompanyPhone(e.target.value)}
                    placeholder="+234 1 234 5678"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label htmlFor="settings-company-address" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Address
                  </label>
                  <textarea
                    id="settings-company-address"
                    value={companyAddress}
                    onChange={e => setCompanyAddress(e.target.value)}
                    rows={2}
                    placeholder="MMA2, Ikeja, Lagos"
                    className="w-full px-3 py-2 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] resize-none"
                  />
                </div>
                <button
                  onClick={handleSaveCompany}
                  disabled={savingCompany}
                  className="w-full py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded cursor-pointer disabled:opacity-50"
                >
                  {savingCompany ? 'SAVING…' : 'SAVE COMPANY SETTINGS'}
                </button>
                <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed pt-1">
                  Saved to the database — visible on every device immediately, not just this one.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Automation Switches Card */}
      <div className="ehi-card p-4 space-y-4">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase">AUTOMATION SERVICES</div>
        
        {/* Toggle WhatsApp Notifications */}
        <div className="flex justify-between items-center py-1">
          <div className="space-y-0.5">
            <span className="text-[12px] font-bold text-[var(--color-foreground)] block">WhatsApp Business Integrations</span>
            <span className="text-[9px] text-[var(--color-muted)] font-mono block">SMS auto triggers on customer creation / delivery</span>
          </div>
          <button
            onClick={() => setNotifyWhatsApp(!notifyWhatsApp)}
            role="switch"
            aria-checked={notifyWhatsApp}
            aria-label="WhatsApp Business Integrations"
            className="text-[var(--color-success)] ml-3 cursor-pointer"
          >
            {notifyWhatsApp ? <ToggleRight size={38} className="text-[var(--color-success)]" /> : <ToggleLeft size={38} className="text-[var(--color-muted)]" />}
          </button>
        </div>

        {/* Manager Phone — receives EOD summary + alerts */}
        <div className="border-t border-[var(--color-border)] pt-3 space-y-1.5">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-[12px] font-bold text-[var(--color-foreground)] block">Manager Phone (WhatsApp/SMS)</span>
              <span className="text-[9px] text-[var(--color-muted)] font-mono block">Receives EOD summary and fraud alerts after day lock</span>
            </div>
          </div>
          <input
            type="tel"
            value={managerPhone}
            onChange={e => setManagerPhone(e.target.value)}
            placeholder="e.g. 08012345678 or +2348012345678"
            className="ehi-input"
          />
        </div>

        {/* Toggle Google Drive Sync */}
        <div className="flex justify-between items-center py-1 border-t border-[var(--color-border)] pt-3">
          <div className="space-y-0.5">
            <span className="text-[12px] font-bold text-[var(--color-foreground)] block">Google Drive EOD dispatch</span>
            <span className="text-[9px] text-[var(--color-muted)] font-mono block font-mono">Archive daily PDF reports to cloud folder automatically</span>
          </div>
          <button
            onClick={() => setDriveSync(!driveSync)}
            role="switch"
            aria-checked={driveSync}
            aria-label="Google Drive EOD dispatch"
            className="text-[var(--color-success)] ml-3 cursor-pointer"
          >
            {driveSync ? <ToggleRight size={38} className="text-[var(--color-success)]" /> : <ToggleLeft size={38} className="text-[var(--color-muted)]" />}
          </button>
        </div>
      </div>

      {/* Silent Printing (QZ Tray) Card — per-device, visible to every
          role since any agent working a terminal needs to point it at
          that terminal's physical printer. */}
      <div className="ehi-card p-4 space-y-4">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center gap-1.5">
          <Printer size={11} className="text-[var(--color-accent-amber)]" />
          <span>SILENT PRINTING (QZ TRAY)</span>
        </div>

        <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed">
          Optional, per-device. Install QZ Tray on this terminal, then detect
          its printers below and pick one for Receipt and Tag jobs to print
          straight to it with no print dialog. Devices left unconfigured — or
          any device where QZ Tray isn't installed — keep opening the PDF for
          manual printing exactly as before.
        </p>

        <div className={`flex items-center gap-2 px-3 py-2 rounded text-[10px] font-mono ${
          qzStatus === 'available'
            ? 'bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] text-[var(--color-success)]'
            : qzStatus === 'unavailable'
              ? 'bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.15)] text-[var(--color-error)]'
              : 'bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.15)] text-[var(--color-accent-amber)]'
        }`}>
          {qzStatus === 'available'
            ? <><Wifi size={12} /> ● QZ TRAY DETECTED — {qzPrinters.length} printer(s) found</>
            : qzStatus === 'unavailable'
              ? <><WifiOff size={12} /> ✗ QZ Tray not detected on this device</>
              : <><WifiOff size={12} /> ○ Not checked yet</>
          }
        </div>

        <button
          onClick={handleDetectPrinters}
          disabled={qzStatus === 'checking'}
          className="w-full py-2.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] text-[11px] font-bold font-mono rounded border border-[var(--color-border)] disabled:opacity-50 cursor-pointer"
        >
          {qzStatus === 'checking' ? 'DETECTING…' : 'DETECT QZ TRAY PRINTERS'}
        </button>

        <div>
          <label htmlFor="settings-qz-receipt-printer" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
            Receipt Printer
          </label>
          <select
            id="settings-qz-receipt-printer"
            value={receiptPrinter}
            onChange={e => handleReceiptPrinterChange(e.target.value)}
            className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          >
            <option value="">Off — open PDF for manual printing</option>
            {qzPrinters.map(name => <option key={name} value={name}>{name}</option>)}
            {receiptPrinter && !qzPrinters.includes(receiptPrinter) && (
              <option value={receiptPrinter}>{receiptPrinter} (saved, not seen yet)</option>
            )}
          </select>
        </div>

        <div>
          <label htmlFor="settings-qz-tag-printer" className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
            Label / Tag Printer (e.g. XP-402B)
          </label>
          <select
            id="settings-qz-tag-printer"
            value={tagPrinter}
            onChange={e => handleTagPrinterChange(e.target.value)}
            className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
          >
            <option value="">Off — open PDF for manual printing</option>
            {qzPrinters.map(name => <option key={name} value={name}>{name}</option>)}
            {tagPrinter && !qzPrinters.includes(tagPrinter) && (
              <option value={tagPrinter}>{tagPrinter} (saved, not seen yet)</option>
            )}
          </select>
        </div>

        <p className="text-[9px] text-[var(--color-muted)] font-mono leading-relaxed pt-1">
          QZ Tray is free background software from qz.io — install it once on
          this machine, then click "Detect" above.
        </p>
      </div>

      {/* regional and aviation grid container */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* regional station hubs management */}
        <div className="ehi-card p-4 space-y-3">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
          <MapPin size={11} className="text-[var(--color-purple)]" />
          <span>MULTI-HUB OUTPOSTS</span>
        </div>

        <div className="space-y-2">
          {hubs.map((hub: any) => (
            <div key={hub.id} className="p-2.5 bg-[var(--color-surface-2)] rounded border border-[var(--color-border)] space-y-2">
              <div className="flex justify-between items-center text-[11px]">
                <div>
                  <span className="font-bold text-[var(--color-foreground)] block">{hub.name}</span>
                  <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase block">{hub.type} · ID: {hub.code}</span>
                </div>
                
                <button 
                  onClick={() => handleToggleHub(hub.id)}
                  className={`text-[9px] font-mono px-2 py-0.5 rounded border border-solid font-bold uppercase cursor-pointer ${
                    hub.active ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] border-[rgba(16,185,129,0.3)]' :
                    'bg-[var(--color-surface-2)] text-[var(--color-muted)] border-none'
                  }`}
                >
                  {hub.active ? 'Active' : 'Offline'}
                </button>
              </div>
              {/* Shift start hour picker — configures the 6PM–6PM window for EOD and ledger */}
              <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                <span className="text-[9px] font-mono text-[var(--color-muted)] shrink-0">Shift starts at</span>
                <select
                  value={hub.shift_start_hour ?? 18}
                  onChange={e => handleShiftHourChange(hub.id, parseInt(e.target.value))}
                  className="flex-1 h-7 px-2 text-[10px] font-mono rounded bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] cursor-pointer"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2,'0')}:00 {i < 12 ? 'AM' : 'PM'} ({i === 0 ? '12AM midnight' : i === 12 ? '12 Noon' : i < 12 ? `${i}AM` : `${i-12}PM`})</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {(user.role === 'super_admin' || user.role === 'admin') && (
          <div className="pt-2 mt-2 border-t border-[var(--color-border)] space-y-2">
            <div className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider flex items-center gap-1.5">
              <Plus size={10} />
              <span>Add Hub</span>
            </div>
            <input
              type="text"
              placeholder="Name (e.g. Sokoto)"
              value={newHubName}
              onChange={e => setNewHubName(e.target.value)}
              className="w-full h-9 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Code (e.g. SKT)"
                value={newHubCode}
                onChange={e => setNewHubCode(e.target.value)}
                className="w-full h-9 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
              <input
                type="text"
                placeholder="State"
                value={newHubState}
                onChange={e => setNewHubState(e.target.value)}
                className="w-full h-9 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
              />
            </div>
            <select
              value={newHubType}
              onChange={e => setNewHubType(e.target.value as HubType)}
              className="w-full h-9 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
            >
              <option value="Cargo Station">Cargo Station</option>
              <option value="Head Office">Head Office</option>
              <option value="Field Office">Field Office</option>
            </select>
            <button
              onClick={handleAddHub}
              disabled={addingHub || !newHubName.trim() || !newHubCode.trim()}
              className="w-full py-2 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded disabled:opacity-50 cursor-pointer"
            >
              {addingHub ? 'ADDING…' : 'ADD HUB'}
            </button>
          </div>
        )}
        </div>

        {/* aviation air cargo carriers -- read-only, sourced live from the
            same pricing_config row Airline Commissions writes to. Editing
            happens there, not here. */}
        <div className="ehi-card p-4 space-y-3">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
          <Plane size={11} className="text-[var(--color-accent-cobalt)]" />
          <span>AVIATION AIRLINE SUPPORTS</span>
        </div>

        <div className="space-y-2">
          {airlines.map((name: string) => (
            <div key={name} className="p-2.5 bg-[var(--color-surface-2)] rounded border border-[var(--color-border)] text-[11px]">
              <span className="font-bold text-[var(--color-foreground)] block">{name}</span>
            </div>
          ))}
          {airlines.length === 0 && (
            <div className="text-[10px] font-mono text-[var(--color-muted)]">No airlines configured yet.</div>
          )}
        </div>

        {onOpenAirlineCommissions && (
          <button
            onClick={onOpenAirlineCommissions}
            className="w-full py-2 text-[10px] font-mono text-[var(--color-accent-amber)] bg-transparent border border-[var(--color-border)] rounded cursor-pointer hover:bg-[var(--color-surface-2)]"
          >
            Manage airlines &amp; commission rates →
          </button>
        )}
      </div>
      </div>
    </div>
  );
};
