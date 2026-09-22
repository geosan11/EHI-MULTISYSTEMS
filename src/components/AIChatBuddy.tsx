import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import { User } from '../lib/types';
import { supabase } from '../lib/supabase';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// Floating, app-wide "AI Chat Buddy" -- answers one-off questions like
// "what's the price for Lagos to Enugu" or "flights from Lagos to Abuja"
// against the real pricing/flight-board data (server/aiChat.ts resolves the
// fact first, Gemini only phrases it -- see that file's header comment).
//
// Deliberately makes NO network call until the user actually presses Send --
// no greeting fetch on mount, no polling, nothing on tab focus. This is
// what "only used when a message is sent, so we don't waste resources on
// every refresh" means in practice: the component is just inert local state
// (open/closed, message list) until that one explicit action.
export const AIChatBuddy = ({ user }: { user: User }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || '';
      const res = await fetch('/api/ai-chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply || "I couldn't come up with an answer." }]);
    } catch (err: any) {
      setError(err.message || 'AI Buddy is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="ehi-ai-chat-fab"
        aria-label={open ? 'Close AI Chat Buddy' : 'Open AI Chat Buddy'}
        style={{
          position: 'fixed',
          right: '16px',
          width: '52px',
          height: '52px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-accent-amber)',
          color: 'var(--color-on-accent)',
          border: 'none',
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 70,
        }}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className="ehi-ai-chat-panel"
              style={{
                position: 'fixed',
                right: '16px',
                width: 'min(360px, calc(100vw - 32px))',
                height: 'min(520px, calc(100vh - 160px))',
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                zIndex: 70,
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '12px 14px', borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-surface-2)',
              }}>
                <Sparkles size={16} className="text-[var(--color-accent-amber)]" />
                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-foreground)' }}>EHI Buddy</div>
                <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginLeft: 'auto' }}>{user.hub}</div>
              </div>

              <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {messages.length === 0 && (
                  <div style={{ color: 'var(--color-muted)', fontSize: '12px', lineHeight: 1.5 }}>
                    Ask me things like <em>"price for Lagos to Enugu"</em> or <em>"flights from Lagos to Abuja"</em>.
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      background: m.role === 'user' ? 'var(--color-accent-amber)' : 'var(--color-surface-2)',
                      color: m.role === 'user' ? 'var(--color-on-accent)' : 'var(--color-foreground)',
                      border: m.role === 'user' ? 'none' : '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: '13px',
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                  </div>
                ))}
                {loading && (
                  <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-muted)', fontSize: '12px', padding: '4px 2px' }}>
                    <Loader2 size={13} className="animate-spin" /> Thinking…
                  </div>
                )}
                {error && (
                  <div style={{ color: 'var(--color-error)', fontSize: '12px', padding: '4px 2px' }}>{error}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', padding: '10px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Ask a question…"
                  disabled={loading}
                  style={{
                    flex: 1,
                    background: 'var(--color-input-bg)',
                    color: 'var(--color-input-text)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  aria-label="Send"
                  style={{
                    background: 'var(--color-accent-amber)',
                    color: 'var(--color-on-accent)',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    width: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    opacity: loading || !input.trim() ? 0.5 : 1,
                  }}
                >
                  <Send size={15} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};
