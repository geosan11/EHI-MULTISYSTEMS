import { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { LoginScreen } from './components/LoginScreen';
import { EHIApp } from './components/EHIApp';
import { UserProfile, getSession, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';

import { SEED_TRANSACTIONS } from './lib/constants';

const PublicTrackingPage = () => {
  const { waybillId } = useParams<{ waybillId?: string }>();
  const [ref, setRef] = useState(waybillId || '');
  const [searched, setSearched] = useState(!!waybillId);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!waybillId) return;
    setLoading(true);
    setSearched(true);
    const query = waybillId.trim().toUpperCase();
    const found = SEED_TRANSACTIONS.find(
      t => t.id.toUpperCase() === query ||
           (t.awb_tag_number?.toUpperCase() ?? '') === query
    );
    setTimeout(() => {
      setResult(found || null);
      setLoading(false);
    }, 600);
  }, [waybillId]);

  const statusColor = (status: string) => {
    if (status === 'Delivered') return '#10B981';
    if (status === 'In-Transit' || status === 'Departure') return '#3B82F6';
    if (status === 'Arrived') return '#F59E0B';
    return '#64748B';
  };

  const statusSteps = ['Intake', 'Departure', 'In-Transit', 'Arrived', 'Delivered'];

  return (
    <div
      className="flex flex-col items-center justify-start py-10 px-4"
      style={{ background: '#F0F4F8', minHeight: '100dvh' }}
    >
      {/* Header */}
      <div className="text-center mb-8">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}
        >
          <span style={{ fontSize: 22, fontWeight: 900, color: '#F59E0B', fontFamily: 'monospace' }}>
            EHI
          </span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
          EHI Cargo Tracking
        </h1>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
          Track your shipment by waybill or AWB number
        </p>
      </div>

      {/* Search box */}
      <div
        className="w-full max-w-md p-6 rounded-2xl mb-6"
        style={{ background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        <div className="flex gap-3">
          <input
            value={ref}
            onChange={e => setRef(e.target.value.toUpperCase().replace(/[\s-]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (!ref.trim()) return;
                setLoading(true);
                setSearched(true);
                const query = ref.trim().toUpperCase();
                const found = SEED_TRANSACTIONS.find(
                  t => t.id.toUpperCase() === query ||
                       (t.awb_tag_number?.toUpperCase() ?? '') === query
                );
                setTimeout(() => {
                  setResult(found || null);
                  setLoading(false);
                }, 600);
              }
            }}
            placeholder="e.g. AC240619X9Y8 or 14153"
            style={{
              flex: 1, height: 44, padding: '0 12px',
              fontSize: 13, fontFamily: 'monospace',
              border: '1px solid #E2E8F0', borderRadius: 10,
              background: '#F8FAFC', color: '#0F172A',
              outline: 'none',
            }}
          />
          <button
            onClick={() => {
              if (!ref.trim()) return;
              setLoading(true);
              setSearched(true);
              const query = ref.trim().toUpperCase();
              const found = SEED_TRANSACTIONS.find(
                t => t.id.toUpperCase() === query ||
                     (t.awb_tag_number?.toUpperCase() ?? '') === query
              );
              setTimeout(() => {
                setResult(found || null);
                setLoading(false);
              }, 600);
            }}
            disabled={!ref.trim() || loading}
            style={{
              height: 44, padding: '0 20px',
              background: '#F59E0B', border: 'none',
              borderRadius: 10, color: '#0B0F19',
              fontWeight: 800, fontFamily: 'monospace',
              fontSize: 12, cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '...' : 'TRACK'}
          </button>
        </div>
      </div>

      {/* Result */}
      {searched && !loading && (
        <div className="w-full max-w-md">
          {result ? (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            >
              {/* Status banner */}
              <div style={{
                background: statusColor(result.status) + '15',
                borderBottom: `1px solid ${statusColor(result.status)}30`,
                padding: '16px 20px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: statusColor(result.status),
                }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                    {result.name}
                  </div>
                  <div style={{
                    fontSize: 11, fontFamily: 'monospace',
                    color: statusColor(result.status), fontWeight: 700,
                  }}>
                    {result.status?.toUpperCase()}
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
                      <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'monospace' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginTop: 2, fontFamily: 'monospace' }}>
                        {String(value)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Progress steps */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 9, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'monospace', marginBottom: 10 }}>
                    Journey
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                    {statusSteps.map((step, i) => {
                      const currentIdx = statusSteps.indexOf(result.status);
                      const isReached = i <= currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < statusSteps.length - 1 ? 1 : 'none' }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: isReached
                              ? statusColor(result.status)
                              : '#E2E8F0',
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
                          {i < statusSteps.length - 1 && (
                            <div style={{
                              flex: 1, height: 2,
                              background: i < currentIdx ? statusColor(result.status) : '#E2E8F0',
                            }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    {statusSteps.map(step => (
                      <div key={step} style={{
                        fontSize: 8, fontFamily: 'monospace',
                        color: step === result.status ? statusColor(result.status) : '#94A3B8',
                        fontWeight: step === result.status ? 700 : 400,
                        textAlign: 'center', flex: 1,
                      }}>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                borderTop: '1px solid #F1F5F9',
                padding: '12px 20px',
                fontSize: 10, color: '#94A3B8',
                fontFamily: 'monospace', textAlign: 'center',
              }}>
                Powered by EHI Multisystems Logistics Platform
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl p-8 text-center"
              style={{ background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                No shipment found
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                Check the reference number and try again.
                Contact EHI if you believe this is an error.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 32, fontSize: 11, color: '#94A3B8', textAlign: 'center' }}>
        EHI Multisystems Nigeria Limited · MMA2, Ikeja, Lagos
      </div>
    </div>
  );
};

const AuthenticatedApp = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    getSession().then((profile) => {
      if (profile) setUser(profile);
      setAuthLoading(false);
    }).catch((err) => {
      console.warn('getSession catch:', err);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
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
    <BrowserRouter>
      <Routes>
        <Route path="/track/:waybillId" element={<PublicTrackingPage />} />
        <Route path="/track" element={<PublicTrackingPage />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

