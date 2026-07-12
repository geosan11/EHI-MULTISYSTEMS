import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { LoginScreen } from './components/LoginScreen';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { EHIApp } from './components/EHIApp';
import { UserProfile, getSession, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import { Loader2, PackageX } from 'lucide-react';
import ehiLogoImg from './assets/branding/ehi-logo.png';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './lib/ToastContext';
import { ConfirmProvider } from './lib/ConfirmContext';

const PublicTrackingPage = () => {
  const { waybillId } = useParams<{ waybillId?: string }>();
  const [ref, setRef] = useState(waybillId || '');
  const [searched, setSearched] = useState(!!waybillId);
  const [result, setResult] = useState<any>(null);
  const [timeline, setTimeline] = useState<{ event_type: string; hub_name: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTimeline = async (cargoRef: string) => {
    // Explicit column list (public page): event_type/hub_name/created_at
    // only. scanned_by_name (staff identity) and alert_reason/
    // cargo_destination (internal ops detail from wrong-destination
    // catches) are deliberately excluded from what a customer can see.
    // .in() on event_type does the same exclusion at the query level,
    // not just in rendering -- a WRONG_DESTINATION_ALERT should never
    // reach this page's network response at all.
    const { data } = await supabase
      .from('tracking_events')
      .select('event_type, hub_name, created_at')
      .eq('cargo_ref', cargoRef)
      .in('event_type', ['DEPART', 'ARRIVE', 'DELIVER'])
      .order('created_at', { ascending: true });
    setTimeline(data || []);
  };

  const searchTracking = async (query: string) => {
    setLoading(true);
    setSearched(true);
    setTimeline([]);
    setResult(null);

    // Check Cargo Entries
    // NOTE: explicit column list, not select('*') — this page is public and
    // unauthenticated, so only the fields actually shown below should ever
    // leave the server. amount/receipt_mode/bank/entered_by etc. must stay out.
    const { data: cargo } = await supabase
      .from('cargo_entries')
      .select('entry_ref, awb_tag_number, consignee_name, route, content_type, total_kg, total_pcs, status')
      .or(`entry_ref.eq."${query}",awb_tag_number.eq."${query}"`)
      .limit(1);

    if (cargo && cargo.length > 0) {
      const c = cargo[0];
      setResult({
        id: c.entry_ref,
        awb_tag_number: c.awb_tag_number,
        name: c.consignee_name,
        route: c.route,
        contentType: c.content_type,
        kg: c.total_kg,
        pieces: c.total_pcs,
        status: c.status || 'Intake'
      });
      fetchTimeline(c.entry_ref);
      setLoading(false);
      return;
    }

    // Check Marketing Entries
    const { data: marketing } = await supabase
      .from('marketing_entries')
      .select('entry_ref, customer_name, route, status')
      .eq('entry_ref', query)
      .limit(1);

    if (marketing && marketing.length > 0) {
      const m = marketing[0];
      setResult({
        id: m.entry_ref,
        name: m.customer_name,
        route: m.route,
        status: m.status || 'Intake'
      });
      fetchTimeline(m.entry_ref);
      setLoading(false);
      return;
    }

    // Check Manifests (ValueJet)
    const { data: manifest } = await supabase
      .from('manifests')
      .select('transaction_id, passenger_name, destination, excess_kg, total_kg, total_pcs, status')
      .eq('transaction_id', query)
      .limit(1);

    if (manifest && manifest.length > 0) {
      const v = manifest[0];
      setResult({
        id: v.transaction_id,
        name: v.passenger_name,
        route: v.destination,
        kg: v.excess_kg || v.total_kg,
        pieces: v.total_pcs,
        status: v.status || 'Delivered'
      });
      fetchTimeline(v.transaction_id);
      setLoading(false);
      return;
    }

    // Check Package Entries (Package/Parcel desk)
    // No weight/piece count -- this stream is flat-fee, the schema never
    // tracked those. contentType shows 'Package' or 'Parcel' instead.
    const { data: pkg } = await supabase
      .from('package_entries')
      .select('entry_ref, customer_name, destination, content_type, status')
      .eq('entry_ref', query)
      .limit(1);

    if (pkg && pkg.length > 0) {
      const p = pkg[0];
      setResult({
        id: p.entry_ref,
        name: p.customer_name,
        route: p.destination,
        contentType: p.content_type,
        status: p.status || 'Intake'
      });
      fetchTimeline(p.entry_ref);
      setLoading(false);
      return;
    }

    setResult(null);
    setLoading(false);
  };

  useEffect(() => {
    if (!waybillId) return;
    searchTracking(waybillId.trim().toUpperCase());
  }, [waybillId]);

  // Every status string the rest of the app writes for these tables collapses
  // into one of these 4 canonical stages. 'Dispatched' and 'Departure' are
  // both used elsewhere (TransactionLedger.tsx, IncomingToHub.tsx) for the
  // same in-transit state -- matching on a single exact string here caused
  // the progress bar to silently fail to highlight for whichever variant
  // wasn't in the list.
  const STATUS_GROUPS: Record<string, number> = {
    'Intake': 0,
    'Dispatched': 1, 'Departure': 1, 'In-Transit': 1,
    'Arrived': 2,
    'Delivered': 3,
  };
  const canonicalSteps = ['Intake', 'In Transit', 'Arrived', 'Delivered'];
  const currentStepIndex = result ? (STATUS_GROUPS[result.status] ?? 0) : 0;

  const statusColor = (status: string) => {
    const idx = STATUS_GROUPS[status] ?? 0;
    if (idx === 3) return 'var(--color-success)';
    if (idx === 1) return 'var(--color-warning)';
    if (idx === 2) return 'var(--color-accent-cobalt)';
    return 'var(--color-muted)';
  };

  return (
    <div
      className="flex flex-col items-center justify-start py-10 px-4"
      style={{
        background: 'var(--color-background)',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Header */}
      <div className="text-center mb-8">
        <img
          src={ehiLogoImg}
          alt="EHI Multisystems"
          style={{ height: 96, margin: '0 auto 16px', display: 'block' }}
        />
        <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-foreground)', margin: 0 }}>
          Track your shipment
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 4 }}>
          Enter your waybill or AWB number
        </p>
      </div>

      {/* Search box */}
      <div
        className="w-full max-w-md p-6 rounded-2xl mb-6"
        style={{ background: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex gap-3">
          <input
            value={ref}
            onChange={e => setRef(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (!ref.trim()) return;
                searchTracking(ref.trim().toUpperCase());
              }
            }}
            placeholder="EHI-MMA2-CGO-000482"
            style={{
              flex: 1, height: 44, padding: '0 12px',
              fontSize: 13, fontFamily: 'monospace',
              border: '1px solid var(--color-border)', borderRadius: 10,
              background: 'var(--color-input-bg)', color: 'var(--color-input-text)',
              outline: 'none',
            }}
          />
          <button
            onClick={() => {
              if (!ref.trim()) return;
              searchTracking(ref.trim().toUpperCase());
            }}
            disabled={!ref.trim() || loading}
            style={{
              height: 44, padding: '0 22px',
              background: 'var(--color-navy)', border: 'none',
              borderRadius: 10, color: '#FFFFFF',
              fontWeight: 500, fontSize: 13, cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            Track
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="w-full max-w-md flex justify-center py-8">
          <Loader2 className="animate-spin" size={22} style={{ color: 'var(--color-accent-amber)' }} />
        </div>
      )}

      {/* Result */}
      {searched && !loading && (
        <div className="w-full max-w-md">
          {result ? (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
            >
              {/* Status banner */}
              <div style={{
                background: 'var(--color-surface-1)',
                borderBottom: '1px solid var(--color-border)',
                padding: '16px 20px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: statusColor(result.status),
                }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)' }}>
                    {result.name}
                  </div>
                  <div style={{
                    fontSize: 11, color: statusColor(result.status), fontWeight: 500,
                  }}>
                    {result.status}
                  </div>
                </div>
              </div>

              {/* Details */}
              <div style={{ padding: '16px 20px' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: '12px', marginBottom: 16,
                }}>
                  {[
                    { label: 'Reference', value: result.id },
                    { label: 'AWB / Tag', value: result.awb_tag_number || '—' },
                    { label: 'Route', value: result.route || result.detail?.split('·')[0] || '—' },
                    { label: 'Content', value: result.contentType || result.detail?.split('·').pop()?.trim() || '—' },
                    { label: 'Weight', value: result.kg ? `${result.kg} KG` : '—' },
                    { label: 'Pieces', value: result.pieces || '—' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: 'var(--color-light-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-foreground)', marginTop: 2, fontFamily: 'monospace' }}>
                        {String(value)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Progress steps */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, color: 'var(--color-light-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Journey
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    {canonicalSteps.map((step, i) => {
                      const isReached = i <= currentStepIndex;
                      const isCurrent = i === currentStepIndex;
                      return (
                        <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < canonicalSteps.length - 1 ? 1 : 'none' }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: isReached ? statusColor(result.status) : 'var(--color-border-strong)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: isCurrent ? `2px solid ${statusColor(result.status)}` : 'none',
                            position: 'relative', flexShrink: 0,
                          }}>
                            {isReached && !isCurrent && (
                              <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>✓</span>
                            )}
                            {isCurrent && (
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(result.status) }} />
                            )}
                          </div>
                          {i < canonicalSteps.length - 1 && (
                            <div style={{
                              flex: 1, height: 2,
                              background: i < currentStepIndex ? statusColor(result.status) : 'var(--color-border-strong)',
                            }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    {canonicalSteps.map((step, i) => (
                      <div key={step} style={{
                        fontSize: 9,
                        color: i === currentStepIndex ? statusColor(result.status) : 'var(--color-light-muted)',
                        fontWeight: i === currentStepIndex ? 500 : 400,
                        textAlign: 'center', flex: 1,
                      }}>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {timeline.length > 0 && (
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 9, color: 'var(--color-light-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                    Shipment history
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {timeline.map((ev, i) => {
                      const label = ev.event_type === 'DEPART' ? 'Departed'
                        : ev.event_type === 'ARRIVE' ? 'Arrived'
                        : 'Delivered';
                      const dotColor = ev.event_type === 'DELIVER' ? 'var(--color-success)'
                        : ev.event_type === 'ARRIVE' ? 'var(--color-warning)'
                        : 'var(--color-accent-cobalt)';
                      return (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: dotColor, marginTop: 4, flexShrink: 0,
                          }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-foreground)' }}>
                              {label} — {ev.hub_name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-light-muted)', marginTop: 1 }}>
                              {new Date(ev.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div style={{
                borderTop: '1px solid var(--color-border)',
                padding: '12px 20px',
                fontSize: 10, color: 'var(--color-light-muted)', textAlign: 'center',
              }}>
                EHI Multisystems Logistics Platform
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
            >
              <PackageX size={32} style={{ margin: '0 auto 12px', color: 'var(--color-light-muted)' }} />
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)' }}>
                No shipment found
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>
                Check the reference number and try again.
                Contact EHI if you believe this is an error.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 32, fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>
        EHI Multisystems Nigeria Limited · MMA2, Ikeja, Lagos
      </div>
    </div>
  );
};

const AuthenticatedApp = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    getSession().then((profile) => {
      if (profile) setUser(profile);
      setAuthLoading(false);
    }).catch((err) => {
      console.warn('getSession catch:', err);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          // Supabase establishes a real (temporary) session here so the
          // user CAN call updateUser({ password }) -- previously this
          // event type was ignored entirely, so that session just sat
          // there unused and the app fell through to the normal login
          // screen with no way to actually complete the reset.
          setPasswordRecovery(true);
          return;
        }
        if (!session) {
          setUser(null);
        }
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return (
      <div className="bg-[var(--color-obsidian)] flex items-center justify-center" style={{ minHeight: '100dvh' }}>
        <Loader2 className="animate-spin text-[var(--color-accent-amber)]" size={48} />
      </div>
    );
  }

  if (passwordRecovery) {
    return (
      <ResetPasswordScreen
        onDone={() => {
          setPasswordRecovery(false);
          setUser(null); // force a normal sign-in with the new password
        }}
      />
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  const handleLogout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <ErrorBoundary>
      <EHIApp user={user} onLogout={handleLogout} />
    </ErrorBoundary>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/track/:waybillId" element={<PublicTrackingPage />} />
            <Route path="/track" element={<PublicTrackingPage />} />
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}

