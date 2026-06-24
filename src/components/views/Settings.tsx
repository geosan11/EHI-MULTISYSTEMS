import { useState, useEffect } from 'react';
import { User } from '../../lib/types';
import { 
  Settings as SettingsIcon, 
  ToggleLeft, 
  ToggleRight, 
  Plus, 
  MapPin, 
  Plane, 
  Check, 
  ArrowLeft,
  DollarSign,
  Eye, EyeOff, Wifi, WifiOff, Phone, Mail, Building2, Key
} from 'lucide-react';
import { reinitSupabase, getConnectionMode, testSupabaseConnection } from '../../lib/supabase';

export const Settings = ({ 
  user, 
  onBack 
}: { 
  user: User; 
  onBack: () => void;
}) => {
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

  // Company tab
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
  const [vjFreeKg, setVjFreeKg] = useState(
    () => localStorage.getItem('ehi_vj_free_kg') || '20'
  );
  const [vjRatePerKg, setVjRatePerKg] = useState(
    () => localStorage.getItem('ehi_vj_rate_per_kg') || '1000'
  );

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

  const handleSaveCompany = () => {
    localStorage.setItem('ehi_company_name', companyName.trim());
    localStorage.setItem('ehi_company_phone', companyPhone.trim());
    localStorage.setItem('ehi_company_address', companyAddress.trim());
    localStorage.setItem('ehi_vj_free_kg', vjFreeKg);
    localStorage.setItem('ehi_vj_rate_per_kg', vjRatePerKg);
  };

  // Option Toggles (persisted locally)
  const [notifyWhatsApp, setNotifyWhatsApp] = useState(() => {
    return localStorage.getItem('ehi_setting_notify_whatsapp') !== 'false';
  });
  const [driveSync, setDriveSync] = useState(() => {
    return localStorage.getItem('ehi_setting_drive_sync') !== 'false';
  });

  // PRICING MATRIX STATE (BB/MB/SB pricing)
  const [pricing, setPricing] = useState(() => {
    const saved = localStorage.getItem('ehi_setting_pricing');
    return saved ? JSON.parse(saved) : [
      { id: '1', route: 'Lagos - Abuja', bb: 18000, mb: 12000, sb: 7500 },
      { id: '2', route: 'Lagos - Port Harcourt', bb: 22000, mb: 15000, sb: 9500 },
      { id: '3', route: 'Abuja - Lagos', bb: 18000, mb: 12000, sb: 7500 },
      { id: '4', route: 'Port Harcourt - Lagos', bb: 22000, mb: 15000, sb: 9500 },
      { id: '5', route: 'Lagos - Enugu', bb: 19500, mb: 13000, sb: 8000 }
    ];
  });

  // Multi-Hub and Aviation Settings
  const [hubs, setHubs] = useState(() => {
    const saved = localStorage.getItem('ehi_setting_hubs');
    return saved ? JSON.parse(saved) : [
      { id: 'hub-lagos', name: 'Lagos HQ', code: 'LOS', type: 'Head Office', active: true },
      { id: 'hub-abuja', name: 'Abuja Station', code: 'ABV', type: 'Cargo Station', active: true },
      { id: 'hub-ph', name: 'Port Harcourt Station', code: 'PHC', type: 'Cargo Station', active: true }
    ];
  });

  const [carriers, setCarriers] = useState(() => {
    const saved = localStorage.getItem('ehi_setting_carriers');
    return saved ? JSON.parse(saved) : [
      { code: 'AK', name: 'Arik Air', active: true },
      { code: 'GA', name: 'Green Africa', active: true },
      { code: 'UN', name: 'United Nigeria', active: true }
    ];
  });

  // Persist edits
  useEffect(() => {
    localStorage.setItem('ehi_setting_notify_whatsapp', String(notifyWhatsApp));
  }, [notifyWhatsApp]);

  useEffect(() => {
    localStorage.setItem('ehi_setting_drive_sync', String(driveSync));
  }, [driveSync]);

  useEffect(() => {
    localStorage.setItem('ehi_setting_pricing', JSON.stringify(pricing));
  }, [pricing]);

  useEffect(() => {
    localStorage.setItem('ehi_setting_hubs', JSON.stringify(hubs));
  }, [hubs]);

  useEffect(() => {
    localStorage.setItem('ehi_setting_carriers', JSON.stringify(carriers));
  }, [carriers]);

  const handlePriceUpdate = (id: string, field: 'bb' | 'mb' | 'sb', value: string) => {
    const num = parseInt(value) || 0;
    setPricing((prev: any) => prev.map((p: any) => p.id === id ? { ...p, [field]: num } : p));
  };

  const handleToggleHub = (id: string) => {
    setHubs((prev: any) => prev.map((h: any) => h.id === id ? { ...h, active: !h.active } : h));
  };

  const handleToggleCarrier = (code: string) => {
    setCarriers((prev: any) => prev.map((c: any) => c.code === code ? { ...c, active: !c.active } : c));
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-obsidian)] text-[var(--color-foreground)] p-4 space-y-6 pb-[100px] overflow-y-auto select-none font-sans">
      
      {/* Header back navigation */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <button onClick={onBack} className="flex items-center space-x-1 text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowLeft size={16} />
          <span className="text-[11px] font-mono">Back</span>
        </button>
        <span className="text-[10px] font-mono text-[var(--color-accent-amber)] tracking-widest font-bold">● SYSTEM ADMIN CONSOLE</span>
      </div>

      {user.role === 'super_admin' && (
        <div className="ehi-card overflow-hidden">
          {/* Section header */}
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)] flex items-center gap-2">
            <Key size={13} className="text-[var(--color-accent-amber)]" />
            <span className="text-[9px] font-mono text-[var(--color-accent-amber)] tracking-widest uppercase font-bold">
              CONNECTION & API CONFIGURATION
            </span>
          </div>

          {/* Sub-tabs */}
          <div className="flex border-b border-[rgba(255,255,255,0.05)]">
            {(['CONNECTION','PAYMENTS','NOTIFICATIONS','COMPANY'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setConfigTab(tab)}
                className="flex-1 py-2.5 text-[9px] font-mono tracking-wider cursor-pointer border-none bg-transparent transition-colors"
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
                    : <><WifiOff size={12} /> ◎ DEMO MODE — Data not persisted</>
                  }
                </div>

                {/* URL input */}
                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    type="text"
                    value={supabaseUrl}
                    onChange={e => setSupabaseUrl(e.target.value)}
                    placeholder="https://your-project.supabase.co"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>

                {/* Anon key input with show/hide */}
                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Supabase Anon Key
                  </label>
                  <div className="relative">
                    <input
                      type={showAnonKey ? 'text' : 'password'}
                      value={supabaseAnonKey}
                      onChange={e => setSupabaseAnonKey(e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      className="w-full h-10 px-3 pr-10 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                    <button
                      onClick={() => setShowAnonKey(!showAnonKey)}
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
                  Clear credentials → return to demo mode
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
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Paystack Public Key
                  </label>
                  <input
                    type="text"
                    value={paystackPublicKey}
                    onChange={e => setPaystackPublicKey(e.target.value)}
                    placeholder="pk_live_..."
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
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
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Admin Phone (EOD SMS/WhatsApp)
                  </label>
                  <input
                    type="tel"
                    value={adminPhone}
                    onChange={e => setAdminPhone(e.target.value)}
                    placeholder="+2348012345678"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Admin Email (EOD Reports)
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    placeholder="admin@ehimultisystems.com"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
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
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Name
                  </label>
                  <input
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Phone
                  </label>
                  <input
                    type="tel"
                    value={companyPhone}
                    onChange={e => setCompanyPhone(e.target.value)}
                    placeholder="+234 1 234 5678"
                    className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    Company Address
                  </label>
                  <textarea
                    value={companyAddress}
                    onChange={e => setCompanyAddress(e.target.value)}
                    rows={2}
                    placeholder="MMA2, Ikeja, Lagos"
                    className="w-full px-3 py-2 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)] resize-none"
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                      VJ Free Allowance (KG)
                    </label>
                    <input
                      type="number"
                      value={vjFreeKg}
                      onChange={e => setVjFreeKg(e.target.value)}
                      className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider mb-1">
                      VJ Rate ₦/KG
                    </label>
                    <input
                      type="number"
                      value={vjRatePerKg}
                      onChange={e => setVjRatePerKg(e.target.value)}
                      className="w-full h-10 px-3 text-[12px] font-mono rounded bg-[var(--color-surface-2)] border border-[rgba(255,255,255,0.07)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-accent-amber)]"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSaveCompany}
                  className="w-full py-2.5 bg-[var(--color-accent-amber)] text-[var(--color-obsidian)] text-[11px] font-bold font-mono rounded cursor-pointer"
                >
                  SAVE COMPANY SETTINGS
                </button>
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
            className="text-[var(--color-success)] ml-3 cursor-pointer"
          >
            {notifyWhatsApp ? <ToggleRight size={38} className="text-[var(--color-success)]" /> : <ToggleLeft size={38} className="text-gray-600" />}
          </button>
        </div>

        {/* Toggle Google Drive Sync */}
        <div className="flex justify-between items-center py-1 border-t border-[rgba(255,255,255,0.05)] pt-3">
          <div className="space-y-0.5">
            <span className="text-[12px] font-bold text-[var(--color-foreground)] block">Google Drive EOD dispatch</span>
            <span className="text-[9px] text-[var(--color-muted)] font-mono block font-mono">Archive daily PDF reports to cloud folder automatically</span>
          </div>
          <button 
            onClick={() => setDriveSync(!driveSync)}
            className="text-[var(--color-success)] ml-3 cursor-pointer"
          >
            {driveSync ? <ToggleRight size={38} className="text-[var(--color-success)]" /> : <ToggleLeft size={38} className="text-gray-600" />}
          </button>
        </div>
      </div>

      {/* Routing Matrix Pricing Configuration List */}
      <div className="ehi-card p-4 space-y-4">
        <div className="flex justify-between items-center">
          <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
            <DollarSign size={12} className="text-[var(--color-accent-amber)]" />
            <span>ROUTE PRICING MATRIX (STREAM 1)</span>
          </div>
          <span className="text-[8px] font-mono text-[var(--color-muted)] bg-black/40 px-1.5 py-0.5 rounded uppercase">BB/MB/SB ONLY</span>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {pricing.map((r: any) => (
            <div key={r.id} className="p-3 bg-black/30 rounded border border-[rgba(255,255,255,0.04)] space-y-2">
              <span className="text-[11px] font-bold text-[var(--color-foreground)] uppercase tracking-wide block">{r.route}</span>
              
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">BB BAG (₦)</label>
                  <input 
                    type="number"
                    value={r.bb}
                    onChange={(e) => handlePriceUpdate(r.id, 'bb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">MB BAG (₦)</label>
                  <input 
                    type="number"
                    value={r.mb}
                    onChange={(e) => handlePriceUpdate(r.id, 'mb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
                <div>
                  <label className="text-[8px] font-mono text-[var(--color-muted)] block mb-1">SB BAG (₦)</label>
                  <input 
                    type="number"
                    value={r.sb}
                    onChange={(e) => handlePriceUpdate(r.id, 'sb', e.target.value)}
                    className="w-full bg-[var(--color-surface-1)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-[11px] font-mono text-[var(--color-foreground)] text-center focus:outline-none focus:border-[var(--color-accent-amber)]"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* regional and aviation grid container */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* regional station hubs management */}
        <div className="ehi-card p-4 space-y-3">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
          <MapPin size={11} className="text-purple-400" />
          <span>MULTI-HUB OUTPOSTS</span>
        </div>

        <div className="space-y-2">
          {hubs.map((hub: any) => (
            <div key={hub.id} className="p-2.5 bg-black/40 rounded border border-[rgba(255,255,255,0.04)] flex justify-between items-center text-[11px]">
              <div>
                <span className="font-bold text-[var(--color-foreground)] block">{hub.name}</span>
                <span className="text-[8px] font-mono text-[var(--color-muted)] uppercase block">{hub.type} · ID: {hub.code}</span>
              </div>
              
              <button 
                onClick={() => handleToggleHub(hub.id)}
                className={`text-[9px] font-mono px-2 py-0.5 rounded border border-solid font-bold uppercase cursor-pointer ${
                  hub.active ? 'bg-[rgba(16,185,129,0.15)] text-[var(--color-success)] border-[rgba(16,185,129,0.3)]' :
                  'bg-neutral-800 text-gray-400 border-none'
                }`}
              >
                {hub.active ? 'Active' : 'Offline'}
              </button>
            </div>
          ))}
        </div>
        
        {/* aviation air cargo carriers configuration list */}
        <div className="ehi-card p-4 space-y-3">
        <div className="text-[9px] font-mono text-[var(--color-foreground)] tracking-widest uppercase flex items-center space-x-1.5">
          <Plane size={11} className="text-[var(--color-accent-cobalt)]" />
          <span>AVIATION AIRLINE SUPPORTS</span>
        </div>

        <div className="space-y-2">
          {carriers.map((c: any) => (
            <div key={c.code} className="p-2.5 bg-black/40 rounded border border-[rgba(255,255,255,0.04)] flex justify-between items-center text-[11px]">
              <div>
                <span className="font-bold text-[var(--color-foreground)] block">{c.name}</span>
                <span className="text-[8.5px] font-mono text-[var(--color-muted)] block">Carrier Code: {c.code}</span>
              </div>
              
              <button 
                onClick={() => handleToggleCarrier(c.code)}
                className={`text-[9px] font-mono px-2 py-0.5 rounded border border-solid font-bold uppercase cursor-pointer ${
                  c.active ? 'bg-[rgba(59,130,246,0.15)] text-[var(--color-accent-cobalt)] border-[rgba(59,130,246,0.3)]' :
                  'bg-neutral-800 text-gray-400 border-none'
                }`}
              >
                {c.active ? 'Active' : 'Muted'}
              </button>
            </div>
          ))}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
};
