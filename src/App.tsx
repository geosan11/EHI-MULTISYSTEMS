import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { LoginScreen } from './components/LoginScreen';
import { EHIApp } from './components/EHIApp';
import { UserProfile, getSession, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import { Loader2 } from 'lucide-react';

const PublicTrackingPage = () => {
  const { waybillId } = useParams();
  return (
    <div className="min-h-screen bg-white flex flex-col items-center p-8">
      <div className="text-[24px] font-bold text-black">EHI Tracking</div>
      <div className="mt-4">Waybill: {waybillId}</div>
      <div className="mt-4 text-gray-500">Public tracking timeline will appear here.</div>
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
      <div className="min-h-screen bg-[var(--color-obsidian)] flex items-center justify-center">
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

  return <EHIApp user={user} onLogout={handleLogout} />;
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/track/:waybillId" element={<PublicTrackingPage />} />
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

