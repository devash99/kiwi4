import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { KiwiLogoFull, KiwiLogoMark } from './components/KiwiLogo';
import type { Message } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api/v1';
const API_KEY  = import.meta.env.VITE_API_KEY  || '';
const MAX_CHARS = 1200;

if (!API_KEY) {
  // API key missing — protected endpoints will return 401
}

const USERS: Record<string, { name: string; title: string; initials: string }> = {
  hod:  { name: 'Dr. P. Kishore', title: 'HOD, ECE Department', initials: 'PK' },
  user: { name: 'Guest User',      title: 'ECE Department',      initials: 'GU' },
};

const SUGGESTION_CARDS = [
  { category: 'Attendance',  question: 'Show me all students with attendance below 75%' },
  { category: 'Detention',   question: 'Which students are currently at risk of detention?' },
  { category: 'Academics',   question: 'List the top 5 students by sessional marks' },
  { category: 'Performance', question: 'Show section-wise average attendance for all years' },
];

const PLACEHOLDERS = [
  'Show students below 75% attendance...',
  'Which students are at risk of detention?',
  'List top performers by sessional marks...',
  'Show section-wise attendance breakdown...',
];

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  conversationId: string | null;
  starred: boolean;
  updatedAt: number;
  userId: string;
}

interface Stats {
  total_students: string | number;
  avg_attendance: string;
  total_subjects: string | number;
  semester: string;
}

function storageKey(userId: string) { return `kiwi-sessions-v2-${userId}`; }

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5  && h <= 11) return 'Good morning,';
  if (h >= 12 && h <= 16) return 'Good afternoon,';
  if (h >= 17 && h <= 20) return 'Good evening,';
  return 'Good night,';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(value: string | number) {
  const v = String(value).toLowerCase().trim();
  const isRed   = ['critical', 'below 75%', 'at risk', 'warning', 'detained'].some(k => v.includes(k));
  const isGreen = ['safe', 'above 75%', 'a+'].some(k => v.includes(k)) || v === 's';
  if (isRed)   return <span style={{ background: 'rgba(220,80,80,0.12)', color: '#F28B82', borderRadius: 100, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{value}</span>;
  if (isGreen) return <span style={{ background: 'rgba(82,183,136,0.12)', color: '#52B788',  borderRadius: 100, padding: '2px 10px', fontSize: 11, fontWeight: 500 }}>{value}</span>;
  return value;
}

function renderMarkdown(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    if (line.startsWith('### ')) return <div key={li} style={{ fontSize: 13, fontWeight: 600, color: '#EAF4EE', margin: '8px 0 4px', letterSpacing: '-0.01em' }}>{line.slice(4)}</div>;
    if (line.startsWith('## '))  return <div key={li} style={{ fontSize: 14, fontWeight: 600, color: '#EAF4EE', margin: '10px 0 4px', letterSpacing: '-0.01em' }}>{line.slice(3)}</div>;
    if (line.startsWith('# '))   return <div key={li} style={{ fontSize: 15, fontWeight: 600, color: '#EAF4EE', margin: '12px 0 4px', letterSpacing: '-0.01em' }}>{line.slice(2)}</div>;
    const isBullet  = line.startsWith('• ') || line.startsWith('- ');
    const content   = isBullet ? line.slice(2) : line;
    const formatted = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((seg, si) => {
      if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={si} style={{ color: '#EAF4EE', fontWeight: 600 }}>{seg.slice(2, -2)}</strong>;
      if (seg.startsWith('*')  && seg.endsWith('*') && seg.length > 2) return <em key={si} style={{ color: '#8FA899' }}>{seg.slice(1, -1)}</em>;
      if (seg.startsWith('`')  && seg.endsWith('`'))  return <code key={si} style={{ background: 'rgba(82,183,136,0.10)', color: '#52B788', padding: '1px 6px', borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono', monospace" }}>{seg.slice(1, -1)}</code>;
      return <span key={si}>{seg}</span>;
    });
    return (
      <span key={li}>
        {li > 0 && <br />}
        {isBullet && <span style={{ color: '#52B788', marginRight: 8, opacity: 0.6 }}>·</span>}
        {formatted}
      </span>
    );
  });
}

const PAGE_SIZE = 10;

function PaginatedTable({ rows, colors }: { rows: Record<string, string | number>[]; colors: { text: string; border: string; activeBg: string; sub: string } }) {
  const [page, setPage] = useState(0);
  const total   = rows.length;
  const pages   = Math.ceil(total / PAGE_SIZE);
  const slice   = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const headers = Object.keys(rows[0]);
  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 6,
    padding: '4px 12px', color: disabled ? colors.border : colors.sub,
    fontSize: 11, cursor: disabled ? 'default' : 'pointer',
    transition: 'all 150ms', userSelect: 'none',
  });
  return (
    <div style={{ marginTop: 20, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.sub, textAlign: 'left', padding: '0 12px 10px', borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((row, ri) => (
            <tr key={ri}
              style={{ borderBottom: ri < slice.length - 1 ? `1px solid ${colors.border}` : 'none', transition: 'background 120ms ease' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = colors.activeBg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              {Object.entries(row).map(([key, val], ci) => (
                <td key={ci} style={{ fontSize: 13, color: colors.text, padding: '11px 12px', whiteSpace: 'nowrap' }}>
                  {['Status', 'Grade', 'Risk Level', 'Detention'].includes(key) ? getStatusBadge(val) : String(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: '0 4px' }}>
          <span style={{ fontSize: 11, color: colors.sub }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={btnStyle(page === 0)}>← Prev</button>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={btnStyle(page >= pages - 1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, border = 'rgba(82,183,136,0.10)' }: { text: string; border?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}
      style={{ background: 'none', border: `1px solid ${copied ? 'rgba(82,183,136,0.4)' : border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, color: copied ? '#52B788' : '#8FA899', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 150ms', userSelect: 'none' }}
      onMouseEnter={e => { if (!copied) { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(82,183,136,0.3)'; (e.currentTarget as HTMLElement).style.color = '#EAF4EE'; } }}
      onMouseLeave={e => { if (!copied) { (e.currentTarget as HTMLElement).style.borderColor = border; (e.currentTarget as HTMLElement).style.color = '#8FA899'; } }}
    >{copied ? '✓ Copied' : '⎘ Copy'}</button>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────

const CREDENTIALS: Record<string, { email: string; password: string; userId: string }> = {
  HOD:   { email: 'vnrecehod@gmail.com', password: 'vnrecehod', userId: 'hod'  },
  Other: { email: 'user123@gmail.com',   password: 'user123',   userId: 'user' },
};

function LoginScreen({ onLogin }: { onLogin: (userId: string, role: string) => void }) {
  const [role, setRole]         = useState('HOD');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cred = CREDENTIALS[role];
    if (email.trim() === cred.email && password === cred.password) {
      setLoading(true);
      setTimeout(() => onLogin(cred.userId, role), 400);
    } else {
      setError('Incorrect email or password.');
    }
  };

  const fieldBase: React.CSSProperties = {
    width: '100%', padding: '13px 15px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(82,183,136,0.18)',
    borderRadius: 12, color: '#EAF4EE', fontSize: 14,
    fontFamily: "'DM Sans', system-ui, sans-serif", outline: 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };

  const onFieldFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = '#52B788';
    e.currentTarget.style.boxShadow   = '0 0 0 2px rgba(82,183,136,0.20)';
  };
  const onFieldBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = 'rgba(82,183,136,0.18)';
    e.currentTarget.style.boxShadow   = 'none';
  };

  return (
    <div style={{ height: '100vh', background: '#0B160F', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Radial glow layers */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 700px 600px at 50% 35%, rgba(82,183,136,0.07) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 300px 300px at 30% 70%, rgba(64,145,108,0.04) 0%, transparent 60%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 300px 300px at 70% 25%, rgba(82,183,136,0.04) 0%, transparent 60%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, padding: '0 24px', animation: 'loginFadeIn 420ms cubic-bezier(0.16,1,0.3,1) both' }}>
        <form onSubmit={handleSubmit}
          style={{
            background: 'rgba(20,30,25,0.60)',
            backdropFilter: 'blur(28px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.5)',
            border: '1px solid rgba(82,183,136,0.12)',
            borderRadius: 18,
            padding: '44px 40px 36px',
            display: 'flex', flexDirection: 'column', gap: 20,
            boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 1px 0 rgba(82,183,136,0.08) inset',
          }}
        >
          {/* Logo + header — inside card */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <KiwiLogoMark size={48} />
            </div>
            <div style={{ fontSize: 34, fontWeight: 600, color: '#EAF4EE', letterSpacing: '1.5px', lineHeight: 1 }}>KIWI</div>
            <div style={{ fontSize: 12, color: '#8FA899', marginTop: 7, fontWeight: 400, letterSpacing: '0.02em', opacity: 0.75 }}>Academic Intelligence Platform</div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4D6B5A', marginBottom: 8, display: 'block', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Role</label>
            <select value={role} onChange={e => { setRole(e.target.value); setError(''); }}
              style={{ ...fieldBase, cursor: 'pointer' }}
              onFocus={onFieldFocus as any} onBlur={onFieldBlur as any}
            >
              <option value="HOD">HOD</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4D6B5A', marginBottom: 8, display: 'block', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Email</label>
            <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }}
              placeholder="Enter your email" required style={fieldBase}
              onFocus={onFieldFocus} onBlur={onFieldBlur}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#4D6B5A', marginBottom: 8, display: 'block', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Password</label>
            <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Enter your password" required style={fieldBase}
              onFocus={onFieldFocus} onBlur={onFieldBlur}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#F28B82', background: 'rgba(242,139,130,0.08)', border: '1px solid rgba(242,139,130,0.18)', borderRadius: 8, padding: '9px 13px' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            style={{ padding: '14px', background: 'linear-gradient(135deg, #52B788 0%, #40916C 100%)', border: 'none', borderRadius: 12, color: '#0B160F', fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s ease', fontFamily: "'DM Sans', system-ui, sans-serif", userSelect: 'none', marginTop: 2, opacity: loading ? 0.7 : 1, letterSpacing: '0.01em' }}
            onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(82,183,136,0.30)'; } }}
            onMouseLeave={e => { if (!loading) { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; } }}
            onMouseDown={e => { if (!loading) (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
            onMouseUp={e => { if (!loading) (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 2 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: '#4D6B5A', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7 }}>Demo Credentials</div>
            <div style={{ fontSize: 11, color: '#8FA899', opacity: 0.45, lineHeight: 1.9 }}>
              HOD: vnrecehod@gmail.com / vnrecehod<br />
              Guest: user123@gmail.com / user123
            </div>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes loginFadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        select option { background:#141F17; color:#EAF4EE; }
      `}</style>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({ theme, onThemeToggle, onClose, userName }: {
  theme: 'dark' | 'light'; onThemeToggle: () => void; onClose: () => void; userName: string;
}) {
  const S = theme === 'light'
    ? { panel: '#FFFFFF',  border: 'rgba(30,80,50,0.10)', text: '#1A2A1A', sub: '#4A6054', section: '#F4F7F5' }
    : { panel: '#141F17',  border: 'rgba(82,183,136,0.10)', text: '#EAF4EE', sub: '#8FA899', section: '#1A2820' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 150ms ease-out', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div style={{ background: S.panel, border: `1px solid ${S.border}`, borderRadius: 16, padding: 32, width: 380, animation: 'slideUp 220ms cubic-bezier(0.16,1,0.3,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: S.text, letterSpacing: '-0.01em' }}>Settings</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: S.sub, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, userSelect: 'none' }}>×</button>
        </div>

        <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: S.sub, marginBottom: 10 }}>Account</div>
        <div style={{ background: S.section, border: `1px solid ${S.border}`, borderRadius: 10, padding: '13px 16px', marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: S.text }}>{userName}</div>
          <div style={{ fontSize: 11, color: S.sub, marginTop: 3 }}>ECE Department · VNR VJIET</div>
        </div>

        <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: S.sub, marginBottom: 10 }}>Appearance</div>
        <div style={{ background: S.section, border: `1px solid ${S.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 13, color: S.text }}>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</div>
            <div style={{ fontSize: 11, color: S.sub, marginTop: 2 }}>Toggle interface theme</div>
          </div>
          <div onClick={onThemeToggle}
            style={{ width: 44, height: 24, borderRadius: 12, background: theme === 'dark' ? '#2D6A4F' : '#52B788', border: '1px solid rgba(82,183,136,0.3)', cursor: 'pointer', position: 'relative', transition: 'background 200ms', userSelect: 'none' }}
          >
            <div style={{ position: 'absolute', top: 2, left: theme === 'dark' ? 2 : 20, width: 18, height: 18, borderRadius: '50%', background: '#52B788', transition: 'left 200ms cubic-bezier(0.16,1,0.3,1)' }} />
          </div>
        </div>

        <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: S.sub, marginBottom: 10 }}>Data</div>
        <div style={{ background: S.section, border: `1px solid ${S.border}`, borderRadius: 10, padding: '13px 16px' }}>
          <div style={{ fontSize: 12, color: S.sub, lineHeight: 1.7 }}>
            Chat history is stored locally in your browser per profile. Clearing browser data will remove all sessions.
          </div>
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${S.border}`, display: 'flex', justifyContent: 'center', gap: 6, alignItems: 'center', opacity: 0.4 }}>
          <span style={{ fontSize: 11, color: S.sub }}>Powered by</span>
          <span style={{ fontSize: 11, color: '#52B788', fontWeight: 500 }}>Groq + Supabase</span>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────

function DeleteConfirmModal({ chatTitle, onConfirm, onCancel, theme = 'dark' }: { chatTitle: string; onConfirm: () => void; onCancel: () => void; theme?: 'dark' | 'light' }) {
  const D = theme === 'light'
    ? { panel: '#FFFFFF', border: 'rgba(30,80,50,0.10)', text: '#1A2A1A', sub: '#4A6054', cancelBorder: 'rgba(30,80,50,0.15)' }
    : { panel: '#141F17', border: 'rgba(82,183,136,0.10)', text: '#EAF4EE', sub: '#8FA899', cancelBorder: 'rgba(82,183,136,0.15)' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 150ms ease-out', backdropFilter: 'blur(6px)' }}
      onClick={onCancel}
    >
      <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14, padding: 28, width: 340, animation: 'slideUp 220ms cubic-bezier(0.16,1,0.3,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 500, color: D.text, marginBottom: 8, letterSpacing: '-0.01em' }}>Delete conversation?</div>
        <div style={{ fontSize: 13, color: D.sub, marginBottom: 24, lineHeight: 1.6 }}>
          "<span style={{ color: D.text }}>{chatTitle}</span>" will be permanently removed.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${D.cancelBorder}`, borderRadius: 8, color: D.sub, fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif", userSelect: 'none', transition: 'all 150ms' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(82,183,136,0.3)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = D.cancelBorder}
          >Cancel</button>
          <button onClick={onConfirm}
            style={{ padding: '8px 18px', background: 'rgba(242,139,130,0.10)', border: '1px solid rgba(242,139,130,0.3)', borderRadius: 8, color: '#F28B82', fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif", userSelect: 'none', transition: 'all 150ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(242,139,130,0.20)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(242,139,130,0.10)'; }}
          >Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    const isAuth = localStorage.getItem('auth') === 'true';
    const savedId = localStorage.getItem('userId');
    if (isAuth && savedId && USERS[savedId]) return savedId;
    return null;
  });
  const [appLoading, setAppLoading]         = useState(true);
  const [theme, setTheme]                   = useState<'dark' | 'light'>(() => (localStorage.getItem('kiwi-theme') as 'dark' | 'light') || 'dark');
  const [sidebarOpen, setSidebarOpen]       = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [stats, setStats]                   = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading]     = useState(false);
  const [chatSessions, setChatSessions]     = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId]     = useState<string | null>(null);
  const [input, setInput]                   = useState('');
  const [isThinking, setIsThinking]         = useState(false);
  const [streamingId, setStreamingId]       = useState<string | null>(null);
  const [streamedText, setStreamedText]     = useState('');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [placeholderFade, setPlaceholderFade] = useState(true);
  const [expandedSql, setExpandedSql]       = useState<Set<string>>(new Set());
  const [ellipsis, setEllipsis]             = useState('');
  const [pageLoaded, setPageLoaded]         = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [contextMenu, setContextMenu]       = useState<{ x: number; y: number; chatId: string } | null>(null);
  const [renamingId, setRenamingId]         = useState<string | null>(null);
  const [renameValue, setRenameValue]       = useState('');
  const [starToast, setStarToast]           = useState(false);
  const [errorToast, setErrorToast]         = useState<string | null>(null);
  const [successToast, setSuccessToast]     = useState<string | null>(null);
  const [hoveredMsgId, setHoveredMsgId]     = useState<string | null>(null);
  const [showSettings, setShowSettings]     = useState(false);
  const [deleteConfirm, setDeleteConfirm]   = useState<{ chatId: string; title: string } | null>(null);
  const [isListening, setIsListening]       = useState(false);

  const recognitionRef    = useRef<any>(null);
  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userDropdownRef   = useRef<HTMLDivElement>(null);
  const renameInputRef    = useRef<HTMLInputElement | null>(null);
  const statsIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef      = useRef(false);
  const contextMenuRef    = useRef<HTMLDivElement>(null);

  const safeUserId = (currentUserId && USERS[currentUserId]) ? currentUserId : 'user';
  const user = USERS[safeUserId];

  // ── Theme tokens ────────────────────────────────────────────
  const T = theme === 'light' ? {
    bg: '#F4F7F5', sidebar: '#ECEEED', overlay: '#FFFFFF', subtle: '#E4EAE6',
    border: 'rgba(30,80,50,0.10)', borderHover: 'rgba(30,80,50,0.20)', borderActive: 'rgba(45,106,79,0.50)',
    text: '#1A2A1A', sub: '#4A6054', dim: '#8AA08A',
    card: '#FFFFFF', cardBorder: 'rgba(30,80,50,0.10)', msgBg: '#FFFFFF',
    userBg: '#2D6A4F', userBorder: 'rgba(45,106,79,0.30)',
    inputBg: '#FFFFFF', scrollbar: 'rgba(45,106,79,0.20)', activeBg: 'rgba(82,183,136,0.08)',
    green: '#2D6A4F', greenGhost: 'rgba(45,106,79,0.07)',
  } : {
    bg: '#080F0B', sidebar: '#0E1A12', overlay: '#141F17', subtle: '#1A2820',
    border: 'rgba(82,183,136,0.10)', borderHover: 'rgba(82,183,136,0.22)', borderActive: 'rgba(82,183,136,0.40)',
    text: '#EAF4EE', sub: '#8FA899', dim: '#4D6B5A',
    card: '#141F17', cardBorder: 'rgba(82,183,136,0.10)', msgBg: '#141F17',
    userBg: '#2D6A4F', userBorder: 'rgba(82,183,136,0.25)',
    inputBg: '#141F17', scrollbar: 'rgba(82,183,136,0.15)', activeBg: 'rgba(82,183,136,0.07)',
    green: '#52B788', greenGhost: 'rgba(82,183,136,0.08)',
  };

  // ── Auth handlers ───────────────────────────────────────────
  const handleLogin = useCallback((uid: string, role: string) => {
    const safeId = USERS[uid] ? uid : 'user';
    localStorage.setItem('auth', 'true');
    localStorage.setItem('userId', safeId);
    localStorage.setItem('kiwi-role', role);
    setCurrentUserId(safeId);
    try {
      const saved = localStorage.getItem(storageKey(safeId));
      if (saved) {
        const sessions = (JSON.parse(saved) as ChatSession[]).map(c => ({ ...c, updatedAt: c.updatedAt ?? Date.now() }));
        setChatSessions(sessions);
      }
    } catch { setChatSessions([]); }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('auth');
    localStorage.removeItem('userId');
    localStorage.removeItem('kiwi-role');
    setCurrentUserId(null);
    setChatSessions([]);
    setActiveChatId(null);
    setUserDropdownOpen(false);
    setShowSettings(false);
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
  }, []);

  // ── Stats ───────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!currentUserId) return;
    setStatsLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/stats`, { headers: { 'X-API-Key': API_KEY } });
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch { } finally { setStatsLoading(false); }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchStats();
    statsIntervalRef.current = setInterval(fetchStats, 60_000);
    return () => { if (statsIntervalRef.current) clearInterval(statsIntervalRef.current); };
  }, [currentUserId, fetchStats]);

  // ── Effects ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setAppLoading(false); setPageLoaded(true); }, 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    try { localStorage.setItem(storageKey(currentUserId), JSON.stringify(chatSessions)); } catch { }
  }, [chatSessions, currentUserId]);

  useEffect(() => {
    localStorage.setItem('kiwi-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const activeChat = chatSessions.find(c => c.id === activeChatId);
    document.title = activeChat ? `${activeChat.title} — KIWI` : 'KIWI — Campus Intelligence';
  }, [activeChatId, chatSessions]);

  useEffect(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><ellipse cx='24' cy='34' rx='16' ry='14' fill='%236B4226'/><circle cx='40' cy='32' r='18' fill='%232D5A1E'/><circle cx='40' cy='32' r='16' fill='%234A8B2C'/><circle cx='40' cy='32' r='13' fill='%236BBF3B'/><circle cx='40' cy='32' r='9' fill='%239BD770'/><circle cx='40' cy='32' r='5' fill='%23E8F0D0'/><circle cx='40' cy='32' r='2' fill='%23FFFDE8'/></svg>`;
    const link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');
    link.type = 'image/svg+xml'; link.rel = 'shortcut icon';
    link.href = `data:image/svg+xml,${svg}`;
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) setUserDropdownOpen(false);
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); textareaRef.current?.focus(); }
      if (e.key === 'Escape') { setShowSettings(false); setDeleteConfirm(null); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderFade(false);
      setTimeout(() => { setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length); setPlaceholderFade(true); }, 300);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isThinking) return;
    const states = ['', '.', '..', '...'];
    let idx = 0;
    const t = setInterval(() => { idx = (idx + 1) % states.length; setEllipsis(states[idx]); }, 500);
    return () => clearInterval(t);
  }, [isThinking]);

  const activeChat  = chatSessions.find(c => c.id === activeChatId) || null;
  const messages    = activeChat?.messages || [];
  const hasMessages = messages.length > 0;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamedText, isThinking]);
  useEffect(() => { if (renamingId) setTimeout(() => renameInputRef.current?.focus(), 50); }, [renamingId]);

  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);

  useEffect(() => {
    if (!successToast) return;
    const t = setTimeout(() => setSuccessToast(null), 3000);
    return () => clearTimeout(t);
  }, [successToast]);

  // ── Voice input ─────────────────────────────────────────────
  const startVoice = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setErrorToast('Voice input not supported in this browser'); return; }
    if (isListening) { recognitionRef.current?.stop(); return; }
    const rec = new SR();
    rec.lang = 'en-IN'; rec.continuous = false; rec.interimResults = true;
    recognitionRef.current = rec;
    rec.onstart  = () => setIsListening(true);
    rec.onend    = () => setIsListening(false);
    rec.onerror  = () => { setIsListening(false); setErrorToast('Voice input failed. Try again.'); };
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      setInput(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        setIsListening(false);
        if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'; }
      }
    };
    rec.start();
  }, [isListening]);

  // ── Streaming ───────────────────────────────────────────────
  const streamResponse = useCallback((msgId: string, fullText: string) => {
    const words = fullText.split(' ');
    let idx = 0;
    setStreamingId(msgId); setStreamedText('');
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    streamIntervalRef.current = setInterval(() => {
      if (idx < words.length) {
        setStreamedText(prev => (prev ? prev + ' ' : '') + words[idx++]);
      } else {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        setStreamingId(null); setStreamedText('');
      }
    }, 20 + Math.random() * 15);
  }, []);

  const updateChatMessages = useCallback((chatId: string, updater: (prev: Message[]) => Message[]) => {
    setChatSessions(prev => prev.map(c => c.id === chatId ? { ...c, messages: updater(c.messages), updatedAt: Date.now() } : c));
  }, []);

  // ── Send message ────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    if (trimmed.length > MAX_CHARS) { setErrorToast(`Message too long (max ${MAX_CHARS} characters)`); isSendingRef.current = false; return; }

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: Date.now() };
    let chatId = activeChatId;
    let localConvId: string | null = null;

    if (!chatId) {
      const newChat: ChatSession = {
        id: crypto.randomUUID(),
        title: trimmed.length > 42 ? trimmed.slice(0, 42) + '…' : trimmed,
        messages: [userMsg], conversationId: null, starred: false,
        updatedAt: Date.now(), userId: currentUserId!,
      };
      setChatSessions(prev => [newChat, ...prev]);
      chatId = newChat.id;
      setActiveChatId(chatId);
      localConvId = null;
    } else {
      localConvId = chatSessions.find(c => c.id === chatId)?.conversationId || null;
      updateChatMessages(chatId, prev => [...prev, userMsg]);
    }

    setInput('');
    setIsThinking(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
        body: JSON.stringify({ question: trimmed, conversation_id: localConvId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok || !data.success) {
        const msg = data?.error?.message || 'Something went wrong. Try rephrasing your question.';
        throw new Error(msg);
      }

      const elapsed = Date.now() - startTime;
      await new Promise(r => setTimeout(r, Math.max(0, 1200 - elapsed)));

      setChatSessions(prev => prev.map(c => c.id === chatId ? { ...c, conversationId: data.data.conversation_id } : c));

      let content = data.data.answer || '';
      if (!content && data.data.count === 0) content = 'No matching records found for your query. The database returned 0 results.';
      else if (!content) content = `Found ${data.data.count} result${data.data.count === 1 ? '' : 's'}.`;

      const assistantMsg: Message = {
        id: crypto.randomUUID(), role: 'assistant',
        content, sql: data.data.sql, rows: data.data.rows, timestamp: Date.now(),
      };
      updateChatMessages(chatId!, prev => [...prev, assistantMsg]);
      setIsThinking(false);
      streamResponse(assistantMsg.id, assistantMsg.content);

    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      await new Promise(r => setTimeout(r, Math.max(0, 600 - elapsed)));

      const isTimeout = err?.name === 'AbortError';
      const errMsg = isTimeout
        ? 'Request timed out. Please try again.'
        : 'Something went wrong. Please try again.';
      setErrorToast(errMsg);

      const assistantMsg: Message = {
        id: crypto.randomUUID(), role: 'assistant',
        content: errMsg, sql: undefined, rows: undefined, timestamp: Date.now(),
      };
      updateChatMessages(chatId!, prev => [...prev, assistantMsg]);
      setIsThinking(false);
      streamResponse(assistantMsg.id, assistantMsg.content);
    } finally {
      isSendingRef.current = false;
    }
  }, [isThinking, activeChatId, chatSessions, currentUserId, streamResponse, updateChatMessages]);

  // ── Chat actions ────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    setActiveChatId(null); setStreamingId(null); setStreamedText(''); setExpandedSql(new Set());
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
  }, []);

  const loadChat = useCallback((chatId: string) => {
    setActiveChatId(chatId); setStreamingId(null); setStreamedText(''); setExpandedSql(new Set());
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
  }, []);

  const toggleStarChat = useCallback((chatId: string) => {
    setChatSessions(prev => {
      const chat = prev.find(c => c.id === chatId);
      if (!chat) return prev;
      const starredCount = prev.filter(c => c.starred && c.id !== chatId).length;
      if (!chat.starred && starredCount >= 5) {
        setTimeout(() => { setStarToast(true); setTimeout(() => setStarToast(false), 3000); }, 0);
        return prev;
      }
      return prev.map(c => c.id === chatId ? { ...c, starred: !c.starred, updatedAt: Date.now() } : c);
    });
    setContextMenu(null);
  }, []);

  const requestDeleteChat = useCallback((chatId: string) => {
    const chat = chatSessions.find(c => c.id === chatId);
    if (!chat) return;
    setContextMenu(null);
    setDeleteConfirm({ chatId, title: chat.title });
  }, [chatSessions]);

  const confirmDeleteChat = useCallback(() => {
    if (!deleteConfirm) return;
    setChatSessions(prev => prev.filter(c => c.id !== deleteConfirm.chatId));
    setActiveChatId(prev => prev === deleteConfirm.chatId ? null : prev);
    setDeleteConfirm(null);
  }, [deleteConfirm]);

  const startRename = useCallback((chatId: string, currentTitle: string) => {
    setRenamingId(chatId); setRenameValue(currentTitle); setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim())
      setChatSessions(prev => prev.map(c => c.id === renamingId ? { ...c, title: renameValue.trim() } : c));
    setRenamingId(null);
  }, [renamingId, renameValue]);

  const handleExport = useCallback(() => {
    if (!hasMessages) return;
    const messagesWithRows = messages.filter(m => m.rows && m.rows.length > 0);
    if (messagesWithRows.length > 0) {
      let csv = '';
      messagesWithRows.forEach(m => {
        const rows = m.rows!;
        const headers = Object.keys(rows[0]);
        csv += headers.map(h => `"${h}"`).join(',') + '\n';
        rows.forEach(row => { csv += headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',') + '\n'; });
        csv += '\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `kiwi-export-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessToast('Exported as CSV');
    } else {
      const text = messages.map(m => `${m.role === 'user' ? user.name : 'KIWI'} [${formatTime(m.timestamp)}]:\n${m.content}`).join('\n\n---\n\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `kiwi-conversation-${new Date().toISOString().slice(0, 10)}.txt` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessToast('Exported conversation');
    }
  }, [hasMessages, messages, user]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };
  const toggleSql = (id: string) => {
    setExpandedSql(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const sortedChats  = [...chatSessions].sort((a, b) => { if (a.starred !== b.starred) return a.starred ? -1 : 1; return b.updatedAt - a.updatedAt; });
  const starredChats = sortedChats.filter(c => c.starred);
  const recentChats  = sortedChats.filter(c => !c.starred);

  const charCount   = input.length;
  const charWarning = charCount > MAX_CHARS * 0.85;

  const ghostBtn = (disabled = false): React.CSSProperties => ({
    background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 6,
    color: disabled ? T.dim : T.sub, cursor: disabled ? 'default' : 'pointer',
    fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, padding: '6px 12px',
    display: 'flex', alignItems: 'center', gap: 6,
    transition: 'all 200ms cubic-bezier(0.16,1,0.3,1)', userSelect: 'none',
    opacity: disabled ? 0.4 : 1,
  });

  // ── Splash ──────────────────────────────────────────────────
  if (appLoading) {
    return (
      <div style={{ height: '100vh', background: '#080F0B', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <div style={{ animation: 'kiwiSpin 1.8s linear infinite, kiwiPulse 1.8s ease-in-out infinite', display: 'flex' }}>
          <KiwiLogoMark size={52} />
        </div>
        <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 500, color: '#EAF4EE', letterSpacing: '-0.02em' }}>KIWI</span>
        <span style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 12, color: '#4D6B5A' }}>Campus Intelligence</span>
        <style>{`@keyframes kiwiSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes kiwiPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>
    );
  }

  if (!currentUserId) return <LoginScreen onLogin={handleLogin} />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.bg, transition: 'background 300ms' }}>

      {showSettings && <SettingsModal theme={theme} onThemeToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} onClose={() => setShowSettings(false)} userName={user.name} />}
      {deleteConfirm && <DeleteConfirmModal chatTitle={deleteConfirm.title} onConfirm={confirmDeleteChat} onCancel={() => setDeleteConfirm(null)} theme={theme} />}

      {/* ── SIDEBAR ─────────────────────────────────────────── */}
      <div style={{ width: sidebarOpen ? 220 : 0, minWidth: sidebarOpen ? 220 : 0, background: T.sidebar, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width 250ms cubic-bezier(0.16,1,0.3,1), min-width 250ms cubic-bezier(0.16,1,0.3,1)', flexShrink: 0 }}>

        <div style={{ padding: '20px 16px 14px', flexShrink: 0, cursor: 'pointer', transition: 'opacity 200ms', userSelect: 'none' }}
          onClick={startNewChat}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '0.65'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
        >
          <KiwiLogoFull />
        </div>

        <div style={{ padding: '0 10px 12px' }}>
          <button onClick={startNewChat}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: T.greenGhost, border: `1px solid ${T.border}`, borderRadius: 8, color: T.green, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 200ms cubic-bezier(0.16,1,0.3,1)', fontFamily: "'DM Sans', system-ui, sans-serif", userSelect: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.green; (e.currentTarget as HTMLElement).style.color = '#0E1A12'; (e.currentTarget as HTMLElement).style.borderColor = T.green; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = T.greenGhost; (e.currentTarget as HTMLElement).style.color = T.green; (e.currentTarget as HTMLElement).style.borderColor = T.border; }}
          >
            <span style={{ fontSize: 17, lineHeight: 1, fontWeight: 300 }}>+</span> New chat
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 12px' }}>
          {starredChats.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.dim, padding: '6px 10px 6px', marginTop: 4 }}>Starred</div>
              {starredChats.map(chat => (
                <SidebarItem key={chat.id} chat={chat} active={activeChatId === chat.id}
                  isRenaming={renamingId === chat.id} renameValue={renameValue}
                  renameInputRef={renameInputRef} onRenameChange={setRenameValue} onRenameCommit={commitRename}
                  onClick={() => loadChat(chat.id)}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: chat.id }); }}
                  showStar theme={T}
                />
              ))}
              <div style={{ height: 8 }} />
            </>
          )}
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.dim, padding: '6px 10px 6px' }}>Recents</div>
          {recentChats.length === 0
            ? <div style={{ fontSize: 12, color: T.dim, padding: '6px 10px', fontStyle: 'italic' }}>No queries yet</div>
            : recentChats.map(chat => (
              <SidebarItem key={chat.id} chat={chat} active={activeChatId === chat.id}
                isRenaming={renamingId === chat.id} renameValue={renameValue}
                renameInputRef={renameInputRef} onRenameChange={setRenameValue} onRenameCommit={commitRename}
                onClick={() => loadChat(chat.id)}
                onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chatId: chat.id }); }}
                theme={T}
              />
            ))
          }
        </div>

        {/* User profile */}
        <div style={{ position: 'relative', flexShrink: 0 }} ref={userDropdownRef}>
          {userDropdownOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, marginBottom: 6, zIndex: 100, boxShadow: '0 -12px 32px rgba(0,0,0,0.4)' }}>
              <button onClick={() => { setShowSettings(true); setUserDropdownOpen(false); }}
                style={{ width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', color: T.text, fontSize: 13, textAlign: 'left', cursor: 'pointer', borderRadius: 6, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', alignItems: 'center', gap: 8, transition: 'background 120ms', userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.activeBg}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >Settings</button>
              <button onClick={handleLogout}
                style={{ width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', color: '#F28B82', fontSize: 13, textAlign: 'left', cursor: 'pointer', borderRadius: 6, fontFamily: "'DM Sans', system-ui, sans-serif", display: 'flex', alignItems: 'center', gap: 8, transition: 'background 120ms', userSelect: 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.activeBg}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >Sign out</button>
            </div>
          )}
          <div onClick={() => setUserDropdownOpen(p => !p)}
            style={{ padding: '12px 14px', borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', transition: 'background 150ms', userSelect: 'none' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.activeBg}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1B4332', border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 500, color: '#52B788', flexShrink: 0, letterSpacing: '0.02em' }}>{user.initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>{user.name}</div>
              <div style={{ fontSize: 11, color: T.dim, marginTop: 1 }}>{user.title}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: T.bg, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ height: 52, background: T.bg, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(p => !p)}
            style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 18, padding: '6px 8px', borderRadius: 6, transition: 'all 150ms', lineHeight: 1, userSelect: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = T.activeBg; (e.currentTarget as HTMLElement).style.color = T.sub; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = T.dim; }}
          >☰</button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.dim, fontWeight: 400, letterSpacing: '0.02em', paddingRight: 10, borderRight: `1px solid ${T.border}` }}>
              Groq · Supabase
            </span>
            <button onClick={handleExport} disabled={!hasMessages} style={ghostBtn(!hasMessages)}
              onMouseEnter={e => { if (hasMessages) { (e.currentTarget as HTMLElement).style.borderColor = T.borderHover; (e.currentTarget as HTMLElement).style.color = T.text; } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.color = !hasMessages ? T.dim : T.sub; }}
            >↓ Export</button>
            <button onClick={startNewChat} disabled={!hasMessages} style={ghostBtn(!hasMessages)}
              onMouseEnter={e => { if (hasMessages) { (e.currentTarget as HTMLElement).style.borderColor = T.borderHover; (e.currentTarget as HTMLElement).style.color = T.text; } }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.color = !hasMessages ? T.dim : T.sub; }}
            >✕ Clear</button>
          </div>
        </div>

        {/* Prototype disclaimer */}
        <div style={{ textAlign: 'center', fontSize: 11, color: T.dim, padding: '7px 16px', background: theme === 'dark' ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.025)', borderBottom: `1px solid ${T.border}`, flexShrink: 0, opacity: 0.75, letterSpacing: '0.01em' }}>
          Prototype system · AI responses may occasionally be unavailable
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!hasMessages ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '48px 48px 32px', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 700px 500px at 50% 30%, rgba(82,183,136,0.03) 0%, transparent 70%)', pointerEvents: 'none' }} />

              <div style={{ textAlign: 'center', opacity: pageLoaded ? 1 : 0, transform: pageLoaded ? 'translateY(0)' : 'translateY(12px)', transition: 'opacity 500ms, transform 500ms', position: 'relative' }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 52, fontWeight: 500, color: T.text, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                  {getTimeGreeting()}
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 52, fontWeight: 500, color: T.green, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                  {user.name.split(' ').pop()}.
                </div>
                <div style={{ fontSize: 15, color: T.sub, marginTop: 16, fontWeight: 400, opacity: 0.8 }}>
                  Ask anything about the ECE department.
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 8, opacity: 0.6, letterSpacing: '0.01em' }}>
                  Attendance · Marks · Performance · Detention risk
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 580, width: '100%', marginTop: 48 }}>
                {SUGGESTION_CARDS.map((card, i) => (
                  <div key={i} onClick={() => sendMessage(card.question)}
                    style={{ background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 22px', cursor: 'pointer', opacity: pageLoaded ? 1 : 0, transform: pageLoaded ? 'translateY(0)' : 'translateY(10px)', transition: `all 200ms cubic-bezier(0.16,1,0.3,1)`, transitionDelay: `${300 + i * 70}ms`, userSelect: 'none' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.borderHover; el.style.background = T.subtle; el.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.border; el.style.background = T.overlay; el.style.transform = 'translateY(0)'; }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: T.green, marginBottom: 10, opacity: 0.8 }}>{card.category}</div>
                    <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.55, fontWeight: 400 }}>{card.question}</div>
                    <div style={{ marginTop: 14, fontSize: 11, color: T.dim }}>→ Ask KIWI</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ width: '100%', maxWidth: 700, margin: '0 auto', padding: '32px 32px 8px', display: 'flex', flexDirection: 'column', gap: 24, boxSizing: 'border-box' as const, alignSelf: 'center' }}>
              {messages.map((msg, idx) => (
                <div key={msg.id}
                  style={{ animation: `msgFadeUp 200ms cubic-bezier(0.16,1,0.3,1) ${Math.min(idx * 30, 150)}ms both` }}
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => setHoveredMsgId(null)}
                >
                  {msg.role === 'user' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ maxWidth: '68%', background: T.userBg, border: `1px solid ${T.userBorder}`, borderRadius: '14px 4px 14px 14px', padding: '12px 16px', fontSize: 14, lineHeight: 1.65, color: '#EAF4EE' }}>
                        {msg.content}
                      </div>
                      <span style={{ fontSize: 10, color: T.dim, opacity: hoveredMsgId === msg.id ? 1 : 0, transition: 'opacity 150ms' }}>{formatTime(msg.timestamp)}</span>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <KiwiLogoMark size={17} />
                        <span style={{ fontSize: 11, fontWeight: 500, color: T.dim, letterSpacing: '0.05em', textTransform: 'uppercase' }}>KIWI</span>
                        <span style={{ fontSize: 10, color: T.dim, marginLeft: 2, opacity: hoveredMsgId === msg.id ? 1 : 0, transition: 'opacity 150ms' }}>{formatTime(msg.timestamp)}</span>
                      </div>
                      <div style={{ background: T.overlay, border: `1px solid ${T.border}`, borderRadius: '4px 14px 14px 14px', padding: '16px 20px', fontSize: 14, lineHeight: 1.7, color: T.text }}>
                        <div>
                          {streamingId === msg.id
                            ? <span>{renderMarkdown(streamedText)}<span style={{ animation: 'blink 1s infinite', color: T.green, marginLeft: 2 }}>|</span></span>
                            : renderMarkdown(msg.content)
                          }
                        </div>

                        {msg.rows !== undefined && msg.rows.length === 0 && streamingId !== msg.id && (
                          <div style={{ marginTop: 16, padding: '18px', background: T.subtle, border: `1px solid ${T.border}`, borderRadius: 8, textAlign: 'center' }}>
                            <div style={{ fontSize: 13, color: T.sub }}>No records matched your query.</div>
                            <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>Try adjusting your criteria or rephrasing.</div>
                          </div>
                        )}

                        {msg.rows && msg.rows.length > 0 && streamingId !== msg.id && (
                          <PaginatedTable key={msg.id} rows={msg.rows} colors={{ text: T.text, border: T.border, activeBg: T.activeBg, sub: T.sub }} />
                        )}

                        {msg.sql && streamingId !== msg.id && (
                          <div style={{ marginTop: 12 }}>
                            <button onClick={() => toggleSql(msg.id)}
                              style={{ fontSize: 11, color: T.dim, background: 'none', border: 'none', cursor: 'pointer', padding: 0, userSelect: 'none', transition: 'color 150ms' }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.sub}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.dim}
                            >{expandedSql.has(msg.id) ? '↑ Hide SQL' : '↓ View SQL'}</button>
                            {expandedSql.has(msg.id) && (
                              <div style={{ marginTop: 8, background: T.subtle, border: `1px solid ${T.border}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, fontFamily: "'DM Mono', monospace", color: T.sub, overflowX: 'auto', lineHeight: 1.6 }}>
                                {msg.sql}
                              </div>
                            )}
                          </div>
                        )}

                        {streamingId !== msg.id && (
                          <div style={{ marginTop: 12, display: 'flex', opacity: hoveredMsgId === msg.id ? 1 : 0, transition: 'opacity 150ms' }}>
                            <CopyButton text={msg.content} border={T.border} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {isThinking && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', animation: 'msgFadeUp 200ms cubic-bezier(0.16,1,0.3,1) both' }}>
                  <div style={{ animation: 'kiwiSpin 1.8s linear infinite, kiwiPulse 1.8s ease-in-out infinite', display: 'flex' }}>
                    <KiwiLogoMark size={18} />
                  </div>
                  <span style={{ fontSize: 14, color: T.sub }}>Thinking{ellipsis}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── INPUT BAR ─────────────────────────────────────── */}
        <div style={{ background: `linear-gradient(to top, ${T.bg} 70%, transparent)`, padding: '16px 0 24px', flexShrink: 0 }}>
          <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 32px' }}>
            <div
              style={{ background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 12, display: 'flex', alignItems: 'flex-end', padding: '8px 8px 8px 18px', transition: 'border-color 200ms, box-shadow 200ms' }}
              onFocus={e => { if (e.currentTarget === e.target) return; (e.currentTarget as HTMLElement).style.borderColor = T.borderActive; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(82,183,136,0.07)'; }}
              onBlur={e => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; (e.currentTarget as HTMLElement).style.borderColor = T.border; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
            >
              <textarea ref={textareaRef} value={input} onChange={handleTextareaChange} onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDERS[placeholderIdx]} rows={1}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', resize: 'none', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, color: T.text, lineHeight: 1.55, padding: '6px 0', maxHeight: 120, opacity: placeholderFade ? 1 : 0.4, transition: 'opacity 300ms' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingBottom: 2 }}>
                <button onClick={startVoice} title={isListening ? 'Stop' : 'Speak'}
                  style={{ background: isListening ? T.activeBg : 'none', border: isListening ? `1px solid ${T.green}` : '1px solid transparent', borderRadius: 6, color: isListening ? T.green : T.dim, cursor: 'pointer', padding: 8, transition: 'all 150ms', display: 'flex', alignItems: 'center', userSelect: 'none' }}
                  onMouseEnter={e => { if (!isListening) (e.currentTarget as HTMLElement).style.color = T.sub; }}
                  onMouseLeave={e => { if (!isListening) (e.currentTarget as HTMLElement).style.color = T.dim; }}
                >
                  {isListening
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                  }
                </button>
                <button onClick={() => sendMessage(input)} disabled={isThinking || !input.trim()}
                  style={{ background: isThinking || !input.trim() ? T.subtle : T.green, border: 'none', borderRadius: 8, cursor: isThinking || !input.trim() ? 'default' : 'pointer', padding: '8px 14px', transition: 'all 150ms cubic-bezier(0.16,1,0.3,1)', display: 'flex', alignItems: 'center', userSelect: 'none', fontSize: 13, fontWeight: 600, color: isThinking || !input.trim() ? T.dim : '#0E1A12', fontFamily: "'DM Sans', system-ui, sans-serif" }}
                  onMouseEnter={e => { if (!isThinking && input.trim()) { (e.currentTarget as HTMLElement).style.background = '#5EC994'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isThinking || !input.trim() ? T.subtle : T.green; (e.currentTarget as HTMLElement).style.transform = 'none'; }}
                  onMouseDown={e => { if (!isThinking && input.trim()) (e.currentTarget as HTMLElement).style.transform = 'scale(0.96)'; }}
                  onMouseUp={e => { if (!isThinking && input.trim()) (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
                >Send</button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '0 2px' }}>
              <div style={{ fontSize: 11, color: T.dim }}>
                {isListening
                  ? <span style={{ color: T.green, animation: 'blink 1s infinite' }}>● Listening…</span>
                  : <span>Enter to send · Shift+Enter for new line</span>
                }
              </div>
              {charCount > 0 && (
                <span style={{ fontSize: 11, color: charWarning ? '#F28B82' : T.dim, transition: 'color 200ms' }}>{charCount}/{MAX_CHARS}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ─────────────────────────────────────── */}
      <div style={{ width: rightPanelOpen ? 280 : 40, minWidth: rightPanelOpen ? 280 : 40, background: T.sidebar, borderLeft: `1px solid ${T.border}`, transition: 'width 250ms cubic-bezier(0.16,1,0.3,1), min-width 250ms cubic-bezier(0.16,1,0.3,1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {rightPanelOpen ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 20px 16px', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.dim }}>Department</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={fetchStats} title="Refresh"
                  style={{ background: 'none', border: 'none', color: statsLoading ? T.green : T.dim, cursor: 'pointer', fontSize: 13, padding: '2px 4px', transition: 'all 150ms', lineHeight: 1, userSelect: 'none' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.green}
                  onMouseLeave={e => { if (!statsLoading) (e.currentTarget as HTMLElement).style.color = T.dim; }}
                >↻</button>
                <button onClick={() => setRightPanelOpen(false)}
                  style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 16, padding: '2px 4px', transition: 'color 150ms', userSelect: 'none' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = T.sub}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = T.dim}
                >›</button>
              </div>
            </div>

            <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: T.text, letterSpacing: '-0.01em' }}>ECE Department</div>
                <div style={{ fontSize: 12, color: T.dim, marginTop: 3 }}>VNR VJIET · AY 2025–26</div>
              </div>

              {statsLoading && !stats ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{ height: 76, background: T.overlay, borderRadius: 10, border: `1px solid ${T.border}`, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.dim, marginBottom: 12 }}>Live Stats</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      [stats?.total_students ?? '—', 'Total Students'],
                      [stats?.avg_attendance ?? '—', 'Avg Attendance'],
                      [stats?.total_subjects ?? '—', 'Subjects'],
                      [stats?.semester ?? '—', 'Current Semester'],
                    ].map(([val, label]) => (
                      <div key={String(label)}
                        style={{ background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', transition: 'all 200ms cubic-bezier(0.16,1,0.3,1)', cursor: 'default', userSelect: 'none' }}
                        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.borderHover; el.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.border; el.style.transform = 'translateY(0)'; }}
                      >
                        <div style={{ fontSize: 11, color: T.sub, fontWeight: 400, marginBottom: 6 }}>{label}</div>
                        <div style={{ fontSize: 28, fontWeight: 600, color: T.text, letterSpacing: '-0.03em', lineHeight: 1, textShadow: theme === 'dark' ? '0 0 20px rgba(82,183,136,0.20)' : 'none' }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {stats && (
                    <div style={{ marginTop: 12, fontSize: 10, color: T.dim, textAlign: 'right', fontStyle: 'italic', opacity: 0.6 }}>
                      Refreshes every 60s
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52 }}>
            <button onClick={() => setRightPanelOpen(true)}
              style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: 16, padding: '2px 6px', userSelect: 'none' }}>‹</button>
          </div>
        )}
      </div>

      {/* ── CONTEXT MENU ─────────────────────────────────────── */}
      {contextMenu && (
        <div ref={contextMenuRef}
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 10, padding: 4, zIndex: 1000, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', minWidth: 160, animation: 'fadeIn 100ms ease-out' }}>
          {[
            { label: chatSessions.find(c => c.id === contextMenu.chatId)?.starred ? 'Unstar' : 'Star', action: () => toggleStarChat(contextMenu.chatId), color: T.text },
            { label: 'Rename', action: () => startRename(contextMenu.chatId, chatSessions.find(c => c.id === contextMenu.chatId)?.title || ''), color: T.text },
            { label: 'Delete', action: () => requestDeleteChat(contextMenu.chatId), color: '#F28B82' },
          ].map(item => (
            <button key={item.label} onClick={e => { e.stopPropagation(); item.action(); }}
              style={{ width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', color: item.color, fontSize: 13, textAlign: 'left', cursor: 'pointer', borderRadius: 6, fontFamily: "'DM Sans', system-ui, sans-serif", transition: 'background 120ms', userSelect: 'none' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = T.activeBg}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >{item.label}</button>
          ))}
        </div>
      )}

      {/* ── TOASTS ─────────────────────────────────────────── */}
      {starToast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: T.overlay, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 13, color: T.text, zIndex: 2000, animation: 'toastIn 300ms cubic-bezier(0.16,1,0.3,1)', whiteSpace: 'nowrap' }}>
          Maximum 5 starred conversations
        </div>
      )}
      {errorToast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: T.overlay, border: '1px solid rgba(242,139,130,0.3)', borderRadius: 8, padding: '10px 20px', fontSize: 13, color: '#F28B82', zIndex: 2000, animation: 'toastIn 300ms cubic-bezier(0.16,1,0.3,1)', whiteSpace: 'nowrap' }}>
          {errorToast}
        </div>
      )}
      {successToast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: T.overlay, border: `1px solid ${T.borderHover}`, borderRadius: 8, padding: '10px 20px', fontSize: 13, color: T.green, zIndex: 2000, animation: 'toastIn 300ms cubic-bezier(0.16,1,0.3,1)', whiteSpace: 'nowrap' }}>
          {successToast}
        </div>
      )}

      {/* ── GLOBAL STYLES ─────────────────────────────────── */}
      <style>{`
        @keyframes blink      { 0%,50%{opacity:1} 51%,100%{opacity:0} }
        @keyframes fadeIn     { from{opacity:0} to{opacity:1} }
        @keyframes slideUp    { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes msgFadeUp  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes toastIn    { from{opacity:0;transform:translateY(6px) translateX(-50%)} to{opacity:1;transform:translateY(0) translateX(-50%)} }
        @keyframes kiwiSpin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes kiwiPulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes pulse      { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
        textarea::placeholder { color:${T.dim}; font-style:normal; opacity:1; }
        * { -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; box-sizing:border-box; }
        ::-webkit-scrollbar       { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${T.scrollbar}; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:${T.borderActive}; }
        button { font-family:'DM Sans',system-ui,sans-serif; }
      `}</style>
    </div>
  );
}

// ── Sidebar Item ──────────────────────────────────────────────────────────────

function SidebarItem({ chat, active, isRenaming, renameValue, renameInputRef, onRenameChange, onRenameCommit, onClick, onContextMenu, showStar = false, theme }: {
  chat: ChatSession; active: boolean; isRenaming: boolean;
  renameValue: string; renameInputRef: React.RefObject<HTMLInputElement | null>;
  onRenameChange: (v: string) => void; onRenameCommit: () => void;
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void;
  showStar?: boolean; theme: any;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        padding: '8px 12px', borderRadius: active ? '0 8px 8px 0' : 8,
        cursor: 'pointer', fontSize: 13,
        color: active ? theme.green : theme.sub,
        background: active ? 'rgba(82,183,136,0.10)' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 8,
        transition: 'all 150ms ease', marginBottom: 1,
        borderLeft: active ? '2px solid #52B788' : '2px solid transparent',
        fontWeight: active ? 500 : 400, userSelect: 'none',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = theme.activeBg; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {showStar && <span style={{ color: '#52B788', flexShrink: 0, fontSize: 10, opacity: 0.8 }}>★</span>}
      {isRenaming ? (
        <input ref={renameInputRef} value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onRenameCommit(); }}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, background: theme.subtle, border: `1px solid ${theme.borderActive}`, borderRadius: 4, padding: '2px 6px', color: theme.text, fontSize: 12, fontFamily: "'DM Sans', system-ui, sans-serif", outline: 'none' }}
        />
      ) : (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{chat.title}</span>
      )}
    </div>
  );
}
