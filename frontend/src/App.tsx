import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import { KiwiLogoFull, KiwiLogoMark } from './components/KiwiLogo';
import { getMockResponse } from './mockData';
import type { Message } from './types';

// FIX #1: Use environment variables instead of hardcoded secrets
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000/api/v1';
const API_KEY  = import.meta.env.VITE_API_KEY  || '';
const MAX_CHARS = 1200;

// ── FIX #17: Real multi-user profiles ─────────────────────────
const USERS: Record<string, { name: string; title: string; initials: string }> = {
  'dr.rao':  { name: 'Dr. K. Srinivasa Rao', title: 'HOD, ECE',            initials: 'KS' },
  'dinesh':  { name: 'Dr. Dinesh Kumar',      title: 'Assoc. Prof, ECE',    initials: 'DK' },
  'pradeep': { name: 'Pradeep Reddy',         title: 'Lab Coordinator, ECE', initials: 'PR' },
};

// ── FIX #4: Cards matched to queries the DB can answer perfectly ──
const SUGGESTION_CARDS = [
  { category: 'ATTENDANCE',  question: 'Show me all students with attendance below 75%' },
  { category: 'DETENTION',   question: 'Which students are currently at risk of detention?' },
  { category: 'ACADEMICS',   question: 'List the top 5 students by sessional marks' },
  { category: 'PERFORMANCE', question: 'Show section-wise average attendance for all years' },
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
  userId: string; // FIX #6: per-user sessions
}

interface Stats {
  total_students: string | number;
  avg_attendance: string;
  total_subjects: string | number;
  semester: string;
}

// FIX #6: Per-user localStorage key
function storageKey(userId: string) { return `kiwi-sessions-v2-${userId}`; }

function getGreeting(name: string): string {
  const h = new Date().getHours();
  const first = name.split(' ').find(w => !w.startsWith('Dr') && w.length > 1) || name.split(' ')[0];
  if (h >= 5  && h <= 11) return `Good morning, ${first}.`;
  if (h >= 12 && h <= 16) return `Good afternoon, ${first}.`;
  if (h >= 17 && h <= 20) return `Good evening, ${first}.`;
  return `Good night, ${first}.`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(value: string | number) {
  const v = String(value).toLowerCase().trim();
  const isRed   = ['critical', 'below 75%', 'at risk', 'warning', 'detained'].some(k => v.includes(k));
  // FIX #25: Match grade 'S' as exact value, not substring (was matching 'absent', 'courses', etc.)
  const isGreen = ['safe', 'above 75%', 'a+'].some(k => v.includes(k)) || v === 's';
  if (isRed)   return <span style={{ background:'rgba(220,80,80,0.15)',   color:'#F28B82', borderRadius:100, padding:'2px 10px', fontSize:12, fontWeight:500 }}>{value}</span>;
  if (isGreen) return <span style={{ background:'rgba(82,183,136,0.15)', color:'#52B788', borderRadius:100, padding:'2px 10px', fontSize:12, fontWeight:500 }}>{value}</span>;
  return value;
}

// FIX #22: Improved markdown renderer — supports bold, italic, inline code, headers, and bullets
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    // Headers
    if (line.startsWith('### ')) return <div key={li} style={{ fontSize:14, fontWeight:700, color:'#E8EDE8', margin:'8px 0 4px' }}>{line.slice(4)}</div>;
    if (line.startsWith('## ')) return <div key={li} style={{ fontSize:15, fontWeight:700, color:'#E8EDE8', margin:'10px 0 4px' }}>{line.slice(3)}</div>;
    if (line.startsWith('# ')) return <div key={li} style={{ fontSize:16, fontWeight:700, color:'#E8EDE8', margin:'12px 0 4px' }}>{line.slice(2)}</div>;
    // Bullets
    const isBullet = line.startsWith('• ') || line.startsWith('- ');
    const content = isBullet ? line.slice(2) : line;
    // Inline formatting: bold, italic, code
    const formatted = content.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((seg, si) => {
      if (seg.startsWith('**') && seg.endsWith('**')) return <strong key={si} style={{ color:'#E8EDE8', fontWeight:600 }}>{seg.slice(2,-2)}</strong>;
      if (seg.startsWith('*') && seg.endsWith('*') && seg.length > 2) return <em key={si} style={{ color:'#C8D8C8' }}>{seg.slice(1,-1)}</em>;
      if (seg.startsWith('`') && seg.endsWith('`')) return <code key={si} style={{ background:'rgba(82,183,136,0.1)', color:'#52B788', padding:'1px 5px', borderRadius:3, fontSize:12, fontFamily:"'DM Mono', monospace" }}>{seg.slice(1,-1)}</code>;
      return <span key={si}>{seg}</span>;
    });
    return (
      <span key={li}>
        {li > 0 && <br />}
        {isBullet && <span style={{ color:'#52B788', marginRight:6 }}>•</span>}
        {formatted}
      </span>
    );
  });
}

const PAGE_SIZE = 10;

function PaginatedTable({ rows }: { rows: Record<string, string | number>[] }) {
  const [page, setPage] = useState(0);
  const total   = rows.length;
  const pages   = Math.ceil(total / PAGE_SIZE);
  const slice   = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const headers = Object.keys(rows[0]);
  return (
    <div style={{ marginTop:16, overflowX:'auto' }}>
      <table className="result-table" style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#52B788', textAlign:'left', padding:'8px 12px', borderBottom:'1px solid #52B788', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((row, ri) => (
            <tr key={ri}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='#1A2019'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='transparent'}
              style={{ transition:'background 150ms' }}
            >
              {Object.entries(row).map(([key, val], ci) => (
                <td key={ci} style={{ fontSize:13, color:'#E8EDE8', padding:'10px 12px', borderBottom: ri<slice.length-1 ? '1px solid #222D22':'none', whiteSpace:'nowrap' }}>
                  {['Status','Grade','Risk Level','Detention'].includes(key) ? getStatusBadge(val) : String(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12, padding:'0 4px' }}>
          <span style={{ fontSize:12, color:'#4A5E4A' }}>Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,total)} of {total}</span>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{ background:page===0?'transparent':'#1A2019', border:'1px solid #222D22', borderRadius:6, padding:'4px 10px', color:page===0?'#2A3A2A':'#8AA88A', fontSize:12, cursor:page===0?'default':'pointer' }}>← Prev</button>
            <button onClick={() => setPage(p=>Math.min(pages-1,p+1))} disabled={page>=pages-1} style={{ background:page>=pages-1?'transparent':'#1A2019', border:'1px solid #222D22', borderRadius:6, padding:'4px 10px', color:page>=pages-1?'#2A3A2A':'#8AA88A', fontSize:12, cursor:page>=pages-1?'default':'pointer' }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// FIX #17: Added .catch() to handle clipboard failures (HTTP pages, unfocused window)
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(()=>setCopied(false),2000); }).catch(() => {}); }}
      style={{ background:'none', border:'1px solid #222D22', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, color:copied?'#52B788':'#4A5E4A', display:'flex', alignItems:'center', gap:4, transition:'all 200ms' }}
      onMouseEnter={e => { if(!copied){ (e.currentTarget as HTMLElement).style.borderColor='#52B788'; (e.currentTarget as HTMLElement).style.color='#52B788'; }}}
      onMouseLeave={e => { if(!copied){ (e.currentTarget as HTMLElement).style.borderColor='#222D22'; (e.currentTarget as HTMLElement).style.color='#4A5E4A'; }}}
    >{copied ? '✓ Copied!' : '⎘ Copy'}</button>
  );
}

// ── FIX #17 + #22: Login Screen with onboarding ───────────────
function LoginScreen({ onLogin }: { onLogin: (userId: string) => void }) {
  const [hovered, setHovered]   = useState<string|null>(null);
  const [selected, setSelected] = useState<string|null>(null);
  const [firstTime] = useState(() => !Object.keys(USERS).some(uid => localStorage.getItem(storageKey(uid))));

  const handle = (uid: string) => {
    setSelected(uid);
    setTimeout(() => onLogin(uid), 500);
  };

  return (
    <div style={{ height:'100vh', background:'#0C0E0D', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:0, position:'relative', overflow:'hidden' }}>
      {/* Subtle watermark */}
      <div style={{ position:'absolute', opacity:0.025, transform:'scale(12)', pointerEvents:'none' }}>
        <KiwiLogoMark size={80} />
      </div>

      <div style={{ animation:'fadeSlideIn 600ms ease-out both', display:'flex', flexDirection:'column', alignItems:'center', gap:8, marginBottom:48 }}>
        <KiwiLogoMark size={52} />
        <span style={{ fontFamily:"'Cormorant Garamond', serif", fontSize:36, fontWeight:600, color:'#E8EDE8', letterSpacing:'0.15em', marginTop:8 }}>KIWI</span>
        <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:'#4A5E4A', letterSpacing:'0.05em' }}>Campus Intelligence · VNR VJIET</span>
      </div>

      {/* FIX #22: first-time welcome message */}
      {firstTime && (
        <div style={{ animation:'fadeSlideIn 600ms 200ms ease-out both', opacity:0, background:'rgba(82,183,136,0.08)', border:'1px solid rgba(82,183,136,0.2)', borderRadius:10, padding:'12px 24px', marginBottom:32, maxWidth:340, textAlign:'center' }}>
          <div style={{ fontSize:13, color:'#52B788', fontWeight:600, marginBottom:4 }}>Welcome to KIWI</div>
          <div style={{ fontSize:12, color:'#4A5E4A', lineHeight:1.7 }}>Your department's academic data, answered in plain English. Ask anything about attendance, marks, or student performance.</div>
        </div>
      )}

      <div style={{ animation:'fadeSlideIn 600ms 100ms ease-out both', opacity:0, display:'flex', flexDirection:'column', gap:10, width:320 }}>
        <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.5px', color:'#4A5E4A', marginBottom:4, textAlign:'center' }}>Select your profile</div>
        {Object.entries(USERS).map(([uid, user]) => (
          <button key={uid} onClick={() => handle(uid)}
            style={{
              background: selected===uid ? '#1B4332' : hovered===uid ? '#141916' : '#0F110F',
              border: `1px solid ${selected===uid ? '#52B788' : hovered===uid ? '#2D6A4F' : '#222D22'}`,
              borderRadius:10, padding:'14px 20px', cursor:'pointer', transition:'all 200ms',
              display:'flex', alignItems:'center', gap:14, transform: selected===uid?'scale(0.98)':'scale(1)',
            }}
            onMouseEnter={() => setHovered(uid)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{ width:38, height:38, borderRadius:'50%', background: selected===uid?'#52B788':'#1B4332', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color: selected===uid?'#0C0E0D':'#52B788', transition:'all 200ms', flexShrink:0 }}>
              {user.initials}
            </div>
            <div style={{ textAlign:'left' }}>
              <div style={{ fontSize:14, fontWeight:600, color:'#E8EDE8', fontFamily:"'DM Sans', sans-serif" }}>{user.name}</div>
              <div style={{ fontSize:11, color:'#4A5E4A', marginTop:2, fontFamily:"'DM Sans', sans-serif" }}>{user.title}</div>
            </div>
            {selected===uid && <span style={{ marginLeft:'auto', color:'#52B788', fontSize:18 }}>✓</span>}
          </button>
        ))}
      </div>

      {/* FIX #21: Powered by badge */}
      <div style={{ position:'absolute', bottom:24, display:'flex', alignItems:'center', gap:6, opacity:0.4 }}>
        <span style={{ fontSize:11, color:'#4A5E4A', fontFamily:"'DM Sans', sans-serif" }}>Powered by</span>
        <span style={{ fontSize:11, color:'#52B788', fontWeight:600, fontFamily:"'DM Sans', sans-serif" }}>Groq</span>
        <span style={{ fontSize:11, color:'#4A5E4A' }}>+</span>
        <span style={{ fontSize:11, color:'#52B788', fontWeight:600, fontFamily:"'DM Sans', sans-serif" }}>Supabase</span>
      </div>

      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        * { -webkit-font-smoothing:antialiased; box-sizing:border-box; }
      `}</style>
    </div>
  );
}

// ── FIX #11: Settings Modal ────────────────────────────────────
function SettingsModal({ theme, onThemeToggle, onClose, userName }: {
  theme: 'dark'|'light'; onThemeToggle: ()=>void; onClose: ()=>void; userName: string;
}) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeIn 150ms ease-out' }}
      onClick={onClose}
    >
      <div style={{ background:'#141916', border:'1px solid #222D22', borderRadius:14, padding:28, width:360, boxShadow:'0 24px 64px rgba(0,0,0,0.8)', animation:'slideUp 200ms ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <span style={{ fontSize:16, fontWeight:600, color:'#E8EDE8', fontFamily:"'DM Sans', sans-serif" }}>Settings</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'#4A5E4A', cursor:'pointer', fontSize:20, lineHeight:1, padding:4 }}>×</button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', marginBottom:8 }}>Account</div>
          <div style={{ background:'#0C0E0D', border:'1px solid #222D22', borderRadius:8, padding:'12px 14px', marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:500, color:'#E8EDE8' }}>{userName}</div>
            <div style={{ fontSize:11, color:'#4A5E4A', marginTop:2 }}>ECE Department · VNR VJIET</div>
          </div>

          {/* FIX #19: Dark/Light mode toggle */}
          <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', marginBottom:8 }}>Appearance</div>
          <div style={{ background:'#0C0E0D', border:'1px solid #222D22', borderRadius:8, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:13, color:'#E8EDE8' }}>{theme==='dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}</div>
              <div style={{ fontSize:11, color:'#4A5E4A', marginTop:2 }}>Toggle interface theme</div>
            </div>
            <div onClick={onThemeToggle}
              style={{ width:44, height:24, borderRadius:12, background: theme==='dark'?'#1B4332':'#52B788', border:'1px solid #2D6A4F', cursor:'pointer', position:'relative', transition:'background 200ms' }}
            >
              <div style={{ position:'absolute', top:2, left: theme==='dark'?2:20, width:18, height:18, borderRadius:'50%', background:'#52B788', transition:'left 200ms', boxShadow:'0 1px 4px rgba(0,0,0,0.4)' }} />
            </div>
          </div>

          <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', marginBottom:8 }}>Data</div>
          <div style={{ background:'#0C0E0D', border:'1px solid #222D22', borderRadius:8, padding:'12px 14px', marginBottom:4 }}>
            <div style={{ fontSize:12, color:'#4A5E4A', lineHeight:1.7 }}>
              Chat history is stored locally in your browser per profile. Clearing browser data will remove all sessions.
            </div>
          </div>

          {/* FIX #21: Powered by in settings too */}
          <div style={{ marginTop:16, paddingTop:16, borderTop:'1px solid #222D22', display:'flex', justifyContent:'center', gap:6, alignItems:'center', opacity:0.5 }}>
            <span style={{ fontSize:11, color:'#4A5E4A' }}>Powered by</span>
            <span style={{ fontSize:11, color:'#52B788', fontWeight:600 }}>Groq + Supabase</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FIX #15: Delete confirmation modal ────────────────────────
function DeleteConfirmModal({ chatTitle, onConfirm, onCancel }: { chatTitle: string; onConfirm: ()=>void; onCancel: ()=>void }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', animation:'fadeIn 150ms ease-out' }}
      onClick={onCancel}
    >
      <div style={{ background:'#141916', border:'1px solid #222D22', borderRadius:12, padding:24, width:320, boxShadow:'0 24px 64px rgba(0,0,0,0.8)', animation:'slideUp 200ms ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize:15, fontWeight:600, color:'#E8EDE8', marginBottom:8 }}>Delete chat?</div>
        <div style={{ fontSize:13, color:'#8AA88A', marginBottom:20, lineHeight:1.6 }}>
          "<span style={{ color:'#C8D8C8' }}>{chatTitle}</span>" will be permanently removed.
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding:'8px 18px', background:'transparent', border:'1px solid #222D22', borderRadius:7, color:'#8AA88A', fontSize:13, cursor:'pointer', fontFamily:"'DM Sans', sans-serif" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor='#52B788'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor='#222D22'}
          >Cancel</button>
          <button onClick={onConfirm}
            style={{ padding:'8px 18px', background:'rgba(242,139,130,0.15)', border:'1px solid #F28B82', borderRadius:7, color:'#F28B82', fontSize:13, cursor:'pointer', fontFamily:"'DM Sans', sans-serif", transition:'all 200ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='rgba(242,139,130,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='rgba(242,139,130,0.15)'; }}
          >Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  // FIX #17: Auth state
  const [currentUserId, setCurrentUserId] = useState<string|null>(() => sessionStorage.getItem('kiwi-user'));
  const [appLoading,    setAppLoading]    = useState(true);

  // FIX #19: Theme
  const [theme, setTheme] = useState<'dark'|'light'>(() => (localStorage.getItem('kiwi-theme') as 'dark'|'light') || 'dark');

  const [sidebarOpen,     setSidebarOpen]    = useState(true);
  const [rightPanelOpen,  setRightPanelOpen] = useState(true);

  // FIX #3/#18: Live stats from backend
  const [stats,       setStats]       = useState<Stats|null>(null);
  const [statsLoading,setStatsLoading]= useState(false);

  const [chatSessions,  setChatSessions]  = useState<ChatSession[]>([]);
  const [activeChatId,  setActiveChatId]  = useState<string|null>(null);
  const [input,         setInput]         = useState('');
  const [isThinking,    setIsThinking]    = useState(false);
  const [streamingId,   setStreamingId]   = useState<string|null>(null);
  const [streamedText,  setStreamedText]  = useState('');
  const [placeholderIdx,setPlaceholderIdx]= useState(0);
  const [placeholderFade,setPlaceholderFade]=useState(true);
  const [expandedSql,   setExpandedSql]   = useState<Set<string>>(new Set());
  const [ellipsis,      setEllipsis]      = useState('');
  const [pageLoaded,    setPageLoaded]    = useState(false);
  const [userDropdownOpen,setUserDropdownOpen]=useState(false);
  const [contextMenu,   setContextMenu]   = useState<{x:number;y:number;chatId:string}|null>(null);
  const [renamingId,    setRenamingId]    = useState<string|null>(null);
  const [renameValue,   setRenameValue]   = useState('');
  const [starToast,     setStarToast]     = useState(false);
  const [errorToast,    setErrorToast]    = useState<string|null>(null);
  const [successToast,  setSuccessToast]  = useState<string|null>(null); // FIX #1
  const [hoveredMsgId,  setHoveredMsgId]  = useState<string|null>(null);
  const [showSettings,  setShowSettings]  = useState(false); // FIX #11
  const [deleteConfirm, setDeleteConfirm] = useState<{chatId:string;title:string}|null>(null); // FIX #15

  // FIX #20: Voice input state
  const [isListening,   setIsListening]   = useState(false);
  const recognitionRef = useRef<SpeechRecognition|null>(null);

  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const userDropdownRef   = useRef<HTMLDivElement>(null);
  const renameInputRef    = useRef<HTMLInputElement>(null);
  const statsIntervalRef  = useRef<ReturnType<typeof setInterval>|null>(null);
  // FIX #18: Ref-based guard to prevent duplicate sends from rapid double-clicks
  const isSendingRef      = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const user = currentUserId ? USERS[currentUserId] : null;

  // ── FIX #17: Login handler ─────────────────────────────────
  const handleLogin = useCallback((uid: string) => {
    sessionStorage.setItem('kiwi-user', uid);
    setCurrentUserId(uid);
    // FIX #6: load per-user sessions
    try {
      const saved = localStorage.getItem(storageKey(uid));
      if (saved) {
        const sessions = (JSON.parse(saved) as ChatSession[]).map(c => ({ ...c, updatedAt: c.updatedAt ?? Date.now() }));
        setChatSessions(sessions);
      }
    } catch { setChatSessions([]); }
  }, []);

  // FIX #10: Real logout
  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('kiwi-user');
    setCurrentUserId(null);
    setChatSessions([]);
    setActiveChatId(null);
    setUserDropdownOpen(false);
    setShowSettings(false);
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    if (statsIntervalRef.current)  clearInterval(statsIntervalRef.current);
  }, []);

  // ── FIX #3/#18: Fetch live stats ───────────────────────────
  const fetchStats = useCallback(async () => {
    if (!currentUserId) return;
    setStatsLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/stats`, { headers:{ 'X-API-Key': API_KEY } });
      const data = await res.json();
      if (data.success) setStats(data.data);
    } catch {
      // keep previous stats on failure
    } finally {
      setStatsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    fetchStats();
    // FIX #18: Auto-refresh every 60s
    statsIntervalRef.current = setInterval(fetchStats, 60_000);
    return () => { if (statsIntervalRef.current) clearInterval(statsIntervalRef.current); };
  }, [currentUserId, fetchStats]);

  // ── Splash screen ──────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => { setAppLoading(false); setPageLoaded(true); }, 1000);
    return () => clearTimeout(t);
  }, []);

  // ── FIX #6: Persist sessions per user ─────────────────────
  useEffect(() => {
    if (!currentUserId) return;
    try { localStorage.setItem(storageKey(currentUserId), JSON.stringify(chatSessions)); } catch {}
  }, [chatSessions, currentUserId]);

  // ── FIX #19: Apply theme ───────────────────────────────────
  useEffect(() => {
    localStorage.setItem('kiwi-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // ── Tab title ──────────────────────────────────────────────
  useEffect(() => {
    const activeChat = chatSessions.find(c=>c.id===activeChatId);
    document.title = activeChat ? `${activeChat.title} — KIWI` : 'KIWI — Campus Intelligence';
  }, [activeChatId, chatSessions]);

  // ── Favicon using actual KiwiLogoMark design ───────────────
  useEffect(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><ellipse cx='24' cy='34' rx='16' ry='14' fill='%236B4226'/><circle cx='40' cy='32' r='18' fill='%232D5A1E'/><circle cx='40' cy='32' r='16' fill='%234A8B2C'/><circle cx='40' cy='32' r='13' fill='%236BBF3B'/><circle cx='40' cy='32' r='9' fill='%239BD770'/><circle cx='40' cy='32' r='5' fill='%23E8F0D0'/><circle cx='40' cy='32' r='2' fill='%23FFFDE8'/></svg>`;
    const link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');
    link.type = 'image/svg+xml'; link.rel = 'shortcut icon';
    link.href = `data:image/svg+xml,${svg}`;
    document.head.appendChild(link);
  }, []);

  // ── Close dropdowns on outside click ──────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
  if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) setUserDropdownOpen(false);
  if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null);
};
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Ctrl+K focuses input ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); textareaRef.current?.focus(); }
      if (e.key==='Escape') { setShowSettings(false); setDeleteConfirm(null); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Placeholder cycling ────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderFade(false);
      setTimeout(() => { setPlaceholderIdx(i=>(i+1)%PLACEHOLDERS.length); setPlaceholderFade(true); }, 300);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  // ── Thinking ellipsis ──────────────────────────────────────
  useEffect(() => {
    if (!isThinking) return;
    const states = ['','.','..',  '...'];
    let idx = 0;
    const t = setInterval(() => { idx=(idx+1)%states.length; setEllipsis(states[idx]); }, 500);
    return () => clearInterval(t);
  }, [isThinking]);

  // ── Auto-scroll ────────────────────────────────────────────
  const activeChat = chatSessions.find(c=>c.id===activeChatId) || null;
  const messages   = activeChat?.messages || [];
  const hasMessages= messages.length > 0;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, streamedText, isThinking]);
  useEffect(() => { if (renamingId) setTimeout(()=>renameInputRef.current?.focus(), 50); }, [renamingId]);

  // ── Toast auto-dismiss ─────────────────────────────────────
  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(()=>setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);
  useEffect(() => {
    if (!successToast) return;
    const t = setTimeout(()=>setSuccessToast(null), 3000);
    return () => clearTimeout(t);
  }, [successToast]);

  // ── FIX #20: Voice input ───────────────────────────────────
  const startVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setErrorToast('Voice input not supported in this browser'); return; }
    if (isListening) { recognitionRef.current?.stop(); return; }

    const rec = new SpeechRecognition();
    rec.lang            = 'en-IN';
    rec.continuous      = false;
    rec.interimResults  = true;
    recognitionRef.current = rec;

    rec.onstart  = () => setIsListening(true);
    rec.onend    = () => setIsListening(false);
    rec.onerror  = () => { setIsListening(false); setErrorToast('Voice input failed. Try again.'); };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = Array.from(e.results).map(r=>r[0].transcript).join('');
      setInput(transcript);
      if (e.results[e.results.length-1].isFinal) {
        setIsListening(false);
        if (textareaRef.current) { textareaRef.current.style.height='auto'; textareaRef.current.style.height=Math.min(textareaRef.current.scrollHeight,120)+'px'; }
      }
    };
    rec.start();
  }, [isListening]);

  // ── Streaming ──────────────────────────────────────────────
  // FIX #23: Reduced streaming delay from 40-70ms to 20-35ms per word
  const streamResponse = useCallback((msgId: string, fullText: string) => {
    const words = fullText.split(' ');
    let idx = 0;
    setStreamingId(msgId); setStreamedText('');
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    streamIntervalRef.current = setInterval(() => {
      if (idx < words.length) {
        setStreamedText(prev=>(prev?prev+' ':'')+words[idx++]);
      } else {
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        setStreamingId(null); setStreamedText('');
      }
    }, 20+Math.random()*15);
  }, []);

  const updateChatMessages = useCallback((chatId: string, updater:(prev:Message[])=>Message[]) => {
    setChatSessions(prev=>prev.map(c=>c.id===chatId?{...c,messages:updater(c.messages),updatedAt:Date.now()}:c));
  }, []);

  // ── FIX #13: Send message with proper AI error handling ────
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    // FIX #18: Ref-based guard against double-submit
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    if (trimmed.length > MAX_CHARS) { setErrorToast(`Message too long (max ${MAX_CHARS} characters)`); isSendingRef.current = false; return; }

    // FIX #13: Use crypto.randomUUID() instead of Date.now() to prevent ID collisions
    const userMsg: Message = { id:crypto.randomUUID(), role:'user', content:trimmed, timestamp:Date.now() };
    let chatId = activeChatId;
    // FIX #6: Track conversationId locally to avoid stale state reads
    let localConvId: string | null = null;

    if (!chatId) {
      const newChat: ChatSession = {
        id: crypto.randomUUID(),
        title: trimmed.length>42 ? trimmed.slice(0,42)+'…' : trimmed,
        messages:[userMsg], conversationId:null, starred:false,
        updatedAt:Date.now(), userId: currentUserId!,
      };
      setChatSessions(prev=>[newChat,...prev]);
      chatId = newChat.id;
      setActiveChatId(chatId);
      localConvId = null;
    } else {
      // FIX #6: Read conversationId BEFORE the async gap, from current sessions
      localConvId = chatSessions.find(c=>c.id===chatId)?.conversationId || null;
      updateChatMessages(chatId, prev=>[...prev, userMsg]);
    }

    setInput('');
    setIsThinking(true);
    if (textareaRef.current) textareaRef.current.style.height='auto';

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout    = setTimeout(()=>controller.abort(), 30_000);

      const res = await fetch(`${API_BASE}/chat`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-API-Key':API_KEY },
        body: JSON.stringify({ question:trimmed, conversation_id:localConvId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok || !data.success) {
        // FIX #13: Show the actual error message from API
        const msg = data?.error?.message || 'Something went wrong. Try rephrasing your question.';
        throw new Error(msg);
      }

      const elapsed = Date.now()-startTime;
      await new Promise(r=>setTimeout(r, Math.max(0,1200-elapsed)));

      setChatSessions(prev=>prev.map(c=>c.id===chatId?{...c,conversationId:data.data.conversation_id}:c));

      // FIX #12: Handle zero-results explicitly
      let content = data.data.answer || '';
      if (!content && data.data.count===0) content = 'No matching records found for your query. The database returned 0 results.';
      else if (!content) content = `Found ${data.data.count} result${data.data.count===1?'':'s'}.`;

      const assistantMsg: Message = {
        id:crypto.randomUUID(), role:'assistant',
        content, sql:data.data.sql, rows:data.data.rows, timestamp:Date.now(),
      };
      updateChatMessages(chatId!, prev=>[...prev, assistantMsg]);
      setIsThinking(false);
      streamResponse(assistantMsg.id, assistantMsg.content);

    } catch (err: any) {
      const elapsed = Date.now()-startTime;
      await new Promise(r=>setTimeout(r, Math.max(0,600-elapsed)));

      // FIX #13: Show error toast AND fallback gracefully
      const isTimeout  = err?.name==='AbortError';
      const errMsg     = isTimeout ? 'Request timed out. Using local data.' : (err?.message || 'Could not reach server. Using local data.');
      setErrorToast(errMsg);

      // FIX #12: Show error state instead of silently serving fake data
      const assistantMsg: Message = {
        id:crypto.randomUUID(), role:'assistant',
        content: errMsg, sql: undefined,
        rows: undefined,
        timestamp:Date.now(),
      };
      updateChatMessages(chatId!, prev=>[...prev, assistantMsg]);
      setIsThinking(false);
      streamResponse(assistantMsg.id, assistantMsg.content);
    } finally {
      isSendingRef.current = false;
    }
  }, [isThinking, activeChatId, chatSessions, currentUserId, streamResponse, updateChatMessages]);

  // ── Chat actions ───────────────────────────────────────────
  const startNewChat = useCallback(() => {
    setActiveChatId(null); setStreamingId(null); setStreamedText(''); setExpandedSql(new Set());
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
  }, []);

  const loadChat = useCallback((chatId:string) => {
    setActiveChatId(chatId); setStreamingId(null); setStreamedText(''); setExpandedSql(new Set());
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
  }, []);

  // FIX #2: Star now correctly sorts and persists
  const toggleStarChat = useCallback((chatId:string) => {
    setChatSessions(prev => {
      const chat = prev.find(c=>c.id===chatId);
      if (!chat) return prev;
      const starredCount = prev.filter(c=>c.starred && c.id!==chatId).length;
      if (!chat.starred && starredCount>=5) {
        setTimeout(()=>{setStarToast(true);setTimeout(()=>setStarToast(false),3000)},0);
        return prev;
      }
      return prev.map(c=>c.id===chatId?{...c,starred:!c.starred,updatedAt:Date.now()}:c);
    });
    setContextMenu(null);
  }, []);

  // FIX #15: Delete goes through confirmation
  const requestDeleteChat = useCallback((chatId:string) => {
    const chat = chatSessions.find(c=>c.id===chatId);
    if (!chat) return;
    setContextMenu(null);
    setDeleteConfirm({ chatId, title:chat.title });
  }, [chatSessions]);

  const confirmDeleteChat = useCallback(() => {
    if (!deleteConfirm) return;
    setChatSessions(prev=>prev.filter(c=>c.id!==deleteConfirm.chatId));
    setActiveChatId(prev=>prev===deleteConfirm.chatId?null:prev);
    setDeleteConfirm(null);
  }, [deleteConfirm]);

  const startRename = useCallback((chatId:string, currentTitle:string) => {
    setRenamingId(chatId); setRenameValue(currentTitle); setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && renameValue.trim())
      setChatSessions(prev=>prev.map(c=>c.id===renamingId?{...c,title:renameValue.trim()}:c));
    setRenamingId(null);
  }, [renamingId, renameValue]);

  // FIX #19: Export uses data from state, not DOM scraping (gets ALL rows, not just current page)
  const handleExport = useCallback(() => {
    if (!hasMessages) return;

    // Find all messages with row data
    const messagesWithRows = messages.filter(m => m.rows && m.rows.length > 0);
    if (messagesWithRows.length > 0) {
      let csv = '';
      messagesWithRows.forEach(m => {
        const rows = m.rows!;
        const headers = Object.keys(rows[0]);
        csv += headers.map(h => `"${h}"`).join(',') + '\n';
        rows.forEach(row => {
          csv += headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
        });
        csv += '\n';
      });
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href:url, download:`kiwi-export-${new Date().toISOString().slice(0,10)}.csv` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessToast('✓ Exported as CSV');
    } else {
      // Fallback: export conversation as text
      const text = messages.map(m=>`${m.role==='user'?(user?.name||'User'):'KIWI'} [${formatTime(m.timestamp)}]:\n${m.content}`).join('\n\n---\n\n');
      const blob = new Blob([text], { type:'text/plain;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href:url, download:`kiwi-conversation-${new Date().toISOString().slice(0,10)}.txt` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessToast('✓ Exported conversation');
    }
  }, [hasMessages, messages, user]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el=e.target; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px';
  };
  const toggleSql = (id:string) => {
    setExpandedSql(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  };

  const sortedChats  = [...chatSessions].sort((a,b)=>{ if(a.starred!==b.starred) return a.starred?-1:1; return b.updatedAt-a.updatedAt; });
  const starredChats = sortedChats.filter(c=>c.starred);
  const recentChats  = sortedChats.filter(c=>!c.starred);

  const charCount   = input.length;
  const charWarning = charCount > MAX_CHARS*0.85;

  const ghostBtn = (disabled=false): React.CSSProperties => ({
    background:'transparent', border:`1px solid ${T.border}`, borderRadius:6,
    color:disabled?'#2A3A2A':T.sub, cursor:disabled?'default':'pointer',
    fontFamily:"'DM Sans', sans-serif", fontSize:12, padding:'6px 12px',
    display:'flex', alignItems:'center', gap:6, transition:'all 200ms ease',
  });

  // ── Light mode overrides ───────────────────────────────────
  const T = theme==='light' ? {
    bg:'#F5F7F4', sidebar:'#ECEEED', border:'#D4DDD4', text:'#1A2A1A',
    sub:'#4A5E4A', card:'#FFFFFF', cardBorder:'#D4DDD4', msgBg:'#FFFFFF',
    userBg:'#1B4332', inputBg:'#FFFFFF', scrollbar:'#C8D8C8',
  } : {
    bg:'#0C0E0D', sidebar:'#141916', border:'#222D22', text:'#E8EDE8',
    sub:'#8AA88A', card:'#141916', cardBorder:'#222D22', msgBg:'#141916',
    userBg:'#1B4332', inputBg:'#141916', scrollbar:'#222D22',
  };

  // ── Splash screen ──────────────────────────────────────────
  if (appLoading) {
    return (
      <div style={{ height:'100vh', background:'#0C0E0D', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20 }}>
        <div style={{ animation:'kiwiSpin 1.8s linear infinite, kiwiPulse 1.8s ease-in-out infinite', display:'flex' }}>
          <KiwiLogoMark size={56} />
        </div>
        <span style={{ fontFamily:"'Cormorant Garamond', serif", fontSize:28, fontWeight:600, color:'#E8EDE8', letterSpacing:'0.1em' }}>KIWI</span>
        <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, color:'#4A5E4A' }}>Campus Intelligence</span>
        <style>{`@keyframes kiwiSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes kiwiPulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
      </div>
    );
  }

  // ── FIX #17: Show login if not authenticated ───────────────
  if (!currentUserId) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', position:'relative', background:T.bg, transition:'background 300ms' }}>

      {/* FIX #11/#15: Modals */}
      {showSettings && <SettingsModal theme={theme} onThemeToggle={()=>setTheme(t=>t==='dark'?'light':'dark')} onClose={()=>setShowSettings(false)} userName={user?.name||''} />}
      {deleteConfirm && <DeleteConfirmModal chatTitle={deleteConfirm.title} onConfirm={confirmDeleteChat} onCancel={()=>setDeleteConfirm(null)} />}

      {/* ── LEFT SIDEBAR ───────────────────────────────────── */}
      <div style={{ width:sidebarOpen?240:0, minWidth:sidebarOpen?240:0, background:T.sidebar, borderRight:`1px solid ${T.border}`, display:'flex', flexDirection:'column', overflow:'hidden', transition:'width 250ms ease, min-width 250ms ease', flexShrink:0 }}>
        <div style={{ padding:'20px 16px 14px', flexShrink:0, cursor:'pointer', transition:'opacity 200ms' }}
          onClick={startNewChat}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='0.75'}
          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
          title="New chat"
        >
          <KiwiLogoFull />
        </div>

        <div style={{ padding:'0 10px 14px' }}>
          <button onClick={startNewChat}
            style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'9px 14px', background:'#1B4332', border:'1px solid #2D6A4F', borderRadius:7, color:'#52B788', fontSize:13, fontWeight:500, cursor:'pointer', transition:'all 200ms', fontFamily:"'DM Sans', sans-serif" }}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#52B788';(e.currentTarget as HTMLElement).style.color='#0C0E0D';}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='#1B4332';(e.currentTarget as HTMLElement).style.color='#52B788';}}
          >
            <span style={{ fontSize:18, lineHeight:1 }}>+</span> Start new chat
          </button>
        </div>

        <div style={{ flex:1, overflow:'auto', padding:'0 8px 12px' }}>
          {/* FIX #2: Starred section — actually renders when starred */}
          {starredChats.length>0 && (
            <>
              <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', padding:'6px 10px 4px' }}>Starred</div>
              {starredChats.map(chat=>(
                <SidebarItem key={chat.id} chat={chat} active={activeChatId===chat.id}
                  isRenaming={renamingId===chat.id} renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  onRenameChange={setRenameValue} onRenameCommit={commitRename}
                  onClick={()=>loadChat(chat.id)}
                  onContextMenu={(e)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,chatId:chat.id});}}
                  showStar theme={T}
                />
              ))}
              <div style={{ height:10 }} />
            </>
          )}
          <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', padding:'6px 10px 4px' }}>Recents</div>
          {recentChats.length===0
            ? <div style={{ fontSize:13, fontStyle:'italic', color:'#4A5E4A', padding:'8px 10px' }}>No queries yet</div>
            : recentChats.map(chat=>(
                <SidebarItem key={chat.id} chat={chat} active={activeChatId===chat.id}
                  isRenaming={renamingId===chat.id} renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  onRenameChange={setRenameValue} onRenameCommit={commitRename}
                  onClick={()=>loadChat(chat.id)}
                  onContextMenu={(e)=>{e.preventDefault();setContextMenu({x:e.clientX,y:e.clientY,chatId:chat.id});}}
                  theme={T}
                />
              ))
          }
        </div>

        {/* FIX #10/#11: User profile with working logout + settings */}
        <div style={{ position:'relative', flexShrink:0 }} ref={userDropdownRef}>
          {userDropdownOpen && (
            <div style={{ position:'absolute', bottom:'100%', left:8, right:8, background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:4, marginBottom:4, zIndex:100, boxShadow:'0 -8px 24px rgba(0,0,0,0.4)' }}>
              <button onClick={()=>{setShowSettings(true);setUserDropdownOpen(false);}}
                style={{ width:'100%', padding:'10px 12px', background:'transparent', border:'none', color:T.text, fontSize:13, textAlign:'left', cursor:'pointer', borderRadius:6, fontFamily:"'DM Sans', sans-serif", display:'flex', alignItems:'center', gap:8 }}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=T.sidebar}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
              >⚙ Settings</button>
              <button onClick={handleLogout}
                style={{ width:'100%', padding:'10px 12px', background:'transparent', border:'none', color:'#F28B82', fontSize:13, textAlign:'left', cursor:'pointer', borderRadius:6, fontFamily:"'DM Sans', sans-serif", display:'flex', alignItems:'center', gap:8 }}
                onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=T.sidebar}
                onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
              >↗ Logout</button>
            </div>
          )}
          <div onClick={()=>setUserDropdownOpen(p=>!p)}
            style={{ padding:14, borderTop:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='rgba(82,183,136,0.06)'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
          >
            <div style={{ width:34, height:34, borderRadius:'50%', background:'#1B4332', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:600, color:'#52B788', flexShrink:0 }}>{user?.initials}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, color:T.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user?.name}</div>
              <div style={{ fontSize:11, color:T.sub }}>{user?.title}</div>
            </div>
            <span style={{ color:'#4A5E4A', fontSize:16 }}>⚙</span>
          </div>
        </div>
      </div>

      {/* ── MAIN ────────────────────────────────────────────── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, background:T.bg, overflow:'hidden' }}>

        {/* Header */}
        <div style={{ height:52, background:T.bg, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', flexShrink:0 }}>
          <button onClick={()=>setSidebarOpen(p=>!p)}
            style={{ background:'none', border:'none', color:'#8AA88A', cursor:'pointer', fontSize:20, padding:'6px 8px', borderRadius:6, transition:'background 200ms', lineHeight:1 }}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=T.sidebar}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
          >☰</button>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {/* FIX #21: Powered-by badge in header */}
            <span style={{ fontSize:10, color:'#2D6A4F', fontFamily:"'DM Sans', sans-serif", letterSpacing:'0.5px', paddingRight:8, borderRight:`1px solid ${T.border}` }}>
              Groq + Supabase
            </span>
            {/* FIX #1: Export button with working logic */}
            <button onClick={handleExport} disabled={!hasMessages} style={ghostBtn(!hasMessages)}
              onMouseEnter={e=>{ if(hasMessages){(e.currentTarget as HTMLElement).style.borderColor='#52B788';(e.currentTarget as HTMLElement).style.color='#52B788';}}}
onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=T.border;(e.currentTarget as HTMLElement).style.color=!hasMessages?'#2A3A2A':T.sub;}}              title="Export data as CSV or conversation as text"
            >↓ Export</button>
            <button onClick={startNewChat} disabled={!hasMessages} style={ghostBtn(!hasMessages)}
              onMouseEnter={e=>{ if(hasMessages){(e.currentTarget as HTMLElement).style.borderColor='#52B788';(e.currentTarget as HTMLElement).style.color='#52B788';}}}
onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=T.border;(e.currentTarget as HTMLElement).style.color=!hasMessages?'#2A3A2A':T.sub;}}            >✕ Clear</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:'auto', position:'relative', display:'flex', flexDirection:'column', alignItems:'stretch' }}>
          {!hasMessages ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', padding:24, position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', opacity:0.03, transform:'scale(6)', pointerEvents:'none' }}>
                <KiwiLogoMark size={80} />
              </div>
              <h1 style={{ fontFamily:"'Cormorant Garamond', serif", fontSize:48, fontWeight:500, color:T.text, margin:0, textAlign:'center', opacity:pageLoaded?1:0, transform:pageLoaded?'translateY(0)':'translateY(12px)', transition:'opacity 500ms, transform 500ms' }}>
                {getGreeting(user?.name||'there')}
              </h1>
              <p style={{ fontFamily:"'DM Sans', sans-serif", fontSize:15, color:T.sub, marginTop:10, opacity:pageLoaded?1:0, transition:'opacity 500ms 150ms, transform 500ms 150ms' }}>
                How can KIWI help you today?
              </p>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, maxWidth:580, width:'100%', marginTop:32 }}>
                {SUGGESTION_CARDS.map((card,i)=>(
                  <div key={i} onClick={()=>sendMessage(card.question)}
                    style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:10, padding:'18px 20px', cursor:'pointer', transition:'all 200ms ease', opacity:pageLoaded?1:0, transform:pageLoaded?'translateY(0)':'translateY(10px)', transitionDelay:`${300+i*80}ms` }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor='#52B788';(e.currentTarget as HTMLElement).style.transform='translateY(-2px)';(e.currentTarget as HTMLElement).style.boxShadow='0 8px 24px rgba(82,183,136,0.12)';}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=T.cardBorder;(e.currentTarget as HTMLElement).style.transform='translateY(0)';(e.currentTarget as HTMLElement).style.boxShadow='none';}}
                  >
                    <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#52B788', marginBottom:8 }}>{card.category}</div>
                    <div style={{ fontSize:13.5, color:T.sub, lineHeight:1.6 }}>{card.question}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
<div style={{ width:'100%', maxWidth:700, margin:'0 auto', padding:'24px 24px 8px', display:'flex', flexDirection:'column', gap:24, boxSizing:'border-box' as const, alignSelf:'center' }}>              {messages.map((msg,idx)=>(                <div key={msg.id} style={{ animation:`msgFadeIn 300ms ${Math.min(idx*40,200)}ms ease-out both` }}
                  onMouseEnter={()=>setHoveredMsgId(msg.id)}
                  onMouseLeave={()=>setHoveredMsgId(null)}
                >
                  {msg.role==='user' ? (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                      <div style={{ maxWidth:'80%', background:'#1B4332', border:'1px solid #2D6A4F', borderRadius:'14px 14px 4px 14px', padding:'12px 16px', fontSize:14.5, lineHeight:1.7, color:'#E8EDE8' }}>
                        {msg.content}
                      </div>
                      <span style={{ fontSize:10, color:'#4A5E4A', opacity:hoveredMsgId===msg.id?1:0, transition:'opacity 200ms' }}>{formatTime(msg.timestamp)}</span>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                        <KiwiLogoMark size={18} />
                        <span style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#8AA88A', letterSpacing:'0.5px' }}>KIWI</span>
                        <span style={{ fontSize:10, color:'#4A5E4A', marginLeft:4, opacity:hoveredMsgId===msg.id?1:0, transition:'opacity 200ms' }}>{formatTime(msg.timestamp)}</span>
                      </div>
                      <div style={{ background:T.msgBg, border:`1px solid ${T.border}`, borderRadius:'4px 14px 14px 14px', padding:'16px 20px', fontSize:14.5, lineHeight:1.7, color:T.text, overflowX:'auto' }}>
                        <div>
                          {streamingId===msg.id
                            ? <span>{renderMarkdown(streamedText)}<span style={{ animation:'blink 1s infinite', color:'#52B788', marginLeft:2 }}>|</span></span>
                            : renderMarkdown(msg.content)
                          }
                        </div>

                        {/* FIX #12: Zero rows empty state */}
                        {msg.rows !== undefined && msg.rows.length===0 && streamingId!==msg.id && (
                          <div style={{ marginTop:16, padding:'20px', background:theme==='dark'?'#0B160F':'#F0F5F0', border:`1px solid ${T.border}`, borderRadius:8, textAlign:'center' }}>
                            <div style={{ fontSize:22, marginBottom:8 }}>🔍</div>
                            <div style={{ fontSize:13, color:T.sub }}>No records found matching your query.</div>
                            <div style={{ fontSize:11, color:'#4A5E4A', marginTop:4 }}>Try adjusting your criteria or rephrasing the question.</div>
                          </div>
                        )}

                        {/* Table — FIX #20: key={msg.id} prevents pagination reset on re-render */}
                        {msg.rows && msg.rows.length>0 && streamingId!==msg.id && (
                          <PaginatedTable key={msg.id} rows={msg.rows} />
                        )}

                        {/* SQL toggle */}
                        {msg.sql && msg.sql.length>0 && streamingId!==msg.id && (
                          <div style={{ marginTop:12 }}>
                            <button onClick={()=>toggleSql(msg.id)}
                              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'#4A5E4A', display:'flex', alignItems:'center', gap:6, padding:'4px 0', transition:'color 200ms' }}
                              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='#52B788'}
                              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='#4A5E4A'}
                            >
                              <span style={{ display:'inline-block', transform:expandedSql.has(msg.id)?'rotate(90deg)':'rotate(0)', transition:'transform 200ms' }}>▶</span>
                              View SQL
                            </button>
                            {expandedSql.has(msg.id) && (
                              <div style={{ marginTop:8, background:theme==='dark'?'#0B160F':'#F5F7F4', border:`1px solid ${T.border}`, borderRadius:8, padding:'14px 16px' }}>
                                <pre style={{ fontFamily:"'DM Mono', monospace", fontSize:12, color:'#52B788', whiteSpace:'pre-wrap', margin:0, lineHeight:1.6 }}>{msg.sql}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        {streamingId!==msg.id && (
                          <div style={{ marginTop:12, display:'flex', opacity:hoveredMsgId===msg.id?1:0, transition:'opacity 200ms' }}>
                            <CopyButton text={msg.content} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking */}
              {isThinking && (
  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', animation:'msgFadeIn 300ms ease-out both' }}>
                  <div style={{ animation:'kiwiSpin 1.8s linear infinite, kiwiPulse 1.8s ease-in-out infinite', display:'flex' }}>
                    <KiwiLogoMark size={20} />
                  </div>
                  <span style={{ fontSize:15, color:'#8AA88A' }}>Thinking{ellipsis}</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── INPUT BAR ──────────────────────────────────────── */}
        <div style={{ background:T.bg, borderTop:`1px solid ${T.border}`, padding:'12px 0 14px', flexShrink:0 }}>
          <div style={{ maxWidth:700, margin:'0 auto', padding:'0 24px' }}>
            <div style={{ background:T.inputBg, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 8px 32px rgba(0,0,0,0.3)', display:'flex', alignItems:'flex-end', padding:'6px 6px 6px 16px', transition:'border-color 200ms' }}
              onFocus={e=>{if(e.currentTarget===e.target)return;(e.currentTarget as HTMLElement).style.borderColor='#2D6A4F';}}
              onBlur={e=>{if(e.currentTarget.contains(e.relatedTarget as Node))return;(e.currentTarget as HTMLElement).style.borderColor=T.border;}}
            >
              <textarea ref={textareaRef} value={input} onChange={handleTextareaChange} onKeyDown={handleKeyDown}
                placeholder={PLACEHOLDERS[placeholderIdx]} rows={1}
                style={{ flex:1, background:'transparent', border:'none', outline:'none', resize:'none', fontFamily:"'DM Sans', sans-serif", fontSize:14.5, color:T.text, lineHeight:1.5, padding:'8px 0', maxHeight:120, opacity:placeholderFade?1:0.4, transition:'opacity 300ms' }}
              />
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, paddingBottom:4 }}>
                {/* Attach — intentionally hidden (no UI for ghost features) FIX #9 */}

                {/* FIX #20: Voice button — actually works */}
                <button onClick={startVoice}
                  title={isListening?'Stop listening':'Click to speak'}
                  style={{ background:isListening?'rgba(82,183,136,0.15)':'none', border:isListening?'1px solid #52B788':'1px solid transparent', borderRadius:6, color:isListening?'#52B788':'#4A5E4A', cursor:'pointer', padding:8, transition:'all 200ms', display:'flex', alignItems:'center' }}
                  onMouseEnter={e=>{if(!isListening){(e.currentTarget as HTMLElement).style.color='#8AA88A';}}}
                  onMouseLeave={e=>{if(!isListening){(e.currentTarget as HTMLElement).style.color='#4A5E4A';}}}
                >
                  {isListening
                    ? <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>
                    : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                  }
                </button>

                <button onClick={()=>sendMessage(input)} disabled={isThinking||!input.trim()}
                  style={{ background:isThinking||!input.trim()?T.inputBg:'#1B4332', border:'none', borderRadius:7, cursor:isThinking||!input.trim()?'default':'pointer', padding:'8px 10px', transition:'all 100ms', display:'flex', alignItems:'center' }}
                  onMouseEnter={e=>{if(!isThinking&&input.trim()){(e.currentTarget as HTMLElement).style.background='#52B788';const svg=e.currentTarget.querySelector('svg');if(svg)svg.setAttribute('stroke','#0C0E0D');}}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=isThinking||!input.trim()?T.inputBg:'#1B4332';const svg=e.currentTarget.querySelector('svg');if(svg)svg.setAttribute('stroke',isThinking||!input.trim()?'#2A3A2A':'#52B788');}}
                  onMouseDown={e=>{(e.currentTarget as HTMLElement).style.transform='scale(0.94)';}}
                  onMouseUp={e=>{(e.currentTarget as HTMLElement).style.transform='scale(1)';}}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={isThinking||!input.trim()?'#2A3A2A':'#52B788'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:7, padding:'0 2px' }}>
              <div style={{ fontSize:11, color:'#4A5E4A' }}>
                {isListening
                  ? <span style={{ color:'#52B788', animation:'blink 1s infinite' }}>● Listening… speak now</span>
                  : <><kbd style={{ border:`1px solid ${T.border}`, borderRadius:3, padding:'1px 5px', fontSize:10, color:'#4A5E4A', background:T.inputBg }}>Enter</kbd> to send · <kbd style={{ border:`1px solid ${T.border}`, borderRadius:3, padding:'1px 5px', fontSize:10, color:'#4A5E4A', background:T.inputBg }}>Shift+Enter</kbd> new line · <kbd style={{ border:`1px solid ${T.border}`, borderRadius:3, padding:'1px 5px', fontSize:10, color:'#4A5E4A', background:T.inputBg }}>Ctrl+K</kbd> focus</>
                }
              </div>
              {charCount>0 && (
                <span style={{ fontSize:11, color:charWarning?'#F28B82':'#4A5E4A', transition:'color 200ms' }}>{charCount}/{MAX_CHARS}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────── */}
      <div style={{ width:rightPanelOpen?260:40, minWidth:rightPanelOpen?260:40, background:T.sidebar, borderLeft:`1px solid ${T.border}`, transition:'width 250ms ease, min-width 250ms ease', overflow:'hidden', display:'flex', flexDirection:'column', flexShrink:0 }}>
        {rightPanelOpen ? (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:16, borderBottom:`1px solid ${T.border}` }}>
              <span style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A' }}>Context</span>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                {/* FIX #18: Live refresh indicator */}
                <button onClick={fetchStats} title="Refresh stats"
                  style={{ background:'none', border:'none', color: statsLoading?'#52B788':'#4A5E4A', cursor:'pointer', fontSize:13, padding:'2px 4px', transition:'all 200ms', lineHeight:1 }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='#52B788'}
                  onMouseLeave={e=>{if(!statsLoading)(e.currentTarget as HTMLElement).style.color='#4A5E4A';}}
                >↻</button>
                <button onClick={()=>setRightPanelOpen(false)} style={{ background:'none', border:'none', color:'#4A5E4A', cursor:'pointer', fontSize:16, padding:'2px 6px', transition:'color 200ms' }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.color='#8AA88A'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.color='#4A5E4A'}
                >›</button>
              </div>
            </div>
            <div style={{ padding:16, overflow:'auto', flex:1 }}>
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.text }}>ECE Department</div>
                <div style={{ fontSize:12, color:T.sub, marginBottom:12 }}>VNR VJIET · AY 2025–26</div>
              </div>

              {/* FIX #8: Loading state for stats panel */}
              {statsLoading && !stats ? (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {[1,2,3,4].map(i=>(
                    <div key={i} style={{ height:60, background:T.bg, borderRadius:8, border:`1px solid ${T.border}`, animation:'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              ) : (
                <>
                  {/* FIX #3: Live stats from API, no hardcoded numbers */}
                  <div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'1.2px', color:'#4A5E4A', marginBottom:10 }}>Live Stats</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {[
                      [stats?.total_students ?? '—', 'Students'],
                      [stats?.avg_attendance ?? '—', 'Avg Attendance'],
                      [stats?.total_subjects  ?? '—', 'Subjects'],
                      [stats?.semester ?? '—', 'Semester'],
                    ].map(([val, label])=>(
                      <div key={String(label)} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:8, padding:'12px 10px', textAlign:'center', transition:'border-color 200ms' }}
                        onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='#2D6A4F'}
                        onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor=T.border}
                      >
                        <div style={{ fontSize:20, fontWeight:700, color:'#52B788' }}>{val}</div>
                        <div style={{ fontSize:10, color:'#4A5E4A', marginTop:4 }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {stats && (
                    <div style={{ marginTop:12, fontSize:10, color:'#2D6A4F', textAlign:'right', fontStyle:'italic' }}>
                      Auto-refreshes every 60s
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:52 }}>
            <button onClick={()=>setRightPanelOpen(true)} style={{ background:'none', border:'none', color:'#4A5E4A', cursor:'pointer', fontSize:16, padding:'2px 6px' }}>‹</button>
          </div>
        )}
      </div>

      {/* ── CONTEXT MENU ─────────────────────────────────────── */}
      {contextMenu && (
        <div ref={contextMenuRef} style={{ position:'fixed', left:contextMenu.x, top:contextMenu.y, background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:4, zIndex:1000, boxShadow:'0 8px 32px rgba(0,0,0,0.6)', minWidth:160 }}>
          {[
            { label: chatSessions.find(c=>c.id===contextMenu.chatId)?.starred ? '★  Unstar' : '☆  Star', action:()=>toggleStarChat(contextMenu.chatId), color:T.text },
            { label:'✎  Rename',  action:()=>startRename(contextMenu.chatId, chatSessions.find(c=>c.id===contextMenu.chatId)?.title||''), color:T.text },
            { label:'✕  Delete',  action:()=>requestDeleteChat(contextMenu.chatId), color:'#F28B82' },
          ].map(item=>(
            <button key={item.label} onClick={e=>{e.stopPropagation();item.action();}}
              style={{ width:'100%', padding:'9px 12px', background:'transparent', border:'none', color:item.color, fontSize:13, textAlign:'left', cursor:'pointer', borderRadius:6, fontFamily:"'DM Sans', sans-serif", transition:'background 150ms' }}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=T.sidebar}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
            >{item.label}</button>
          ))}
        </div>
      )}
      {/* ── TOASTS ─────────────────────────────────────────── */}
      {starToast && (
        <div style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)', background:T.card, border:'1px solid #52B788', borderRadius:8, padding:'10px 20px', fontSize:13, color:T.text, zIndex:2000, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', display:'flex', alignItems:'center', gap:8, animation:'fadeSlideIn 300ms ease-out', whiteSpace:'nowrap' }}>
          <span style={{ color:'#52B788' }}>★</span> Maximum 5 starred chats
        </div>
      )}
      {errorToast && (
        <div style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)', background:T.card, border:'1px solid #F28B82', borderRadius:8, padding:'10px 20px', fontSize:13, color:'#F28B82', zIndex:2000, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', animation:'fadeSlideIn 300ms ease-out', whiteSpace:'nowrap' }}>
          ⚠ {errorToast}
        </div>
      )}
      {/* FIX #1: Success toast for export */}
      {successToast && (
        <div style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)', background:T.card, border:'1px solid #52B788', borderRadius:8, padding:'10px 20px', fontSize:13, color:'#52B788', zIndex:2000, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', animation:'fadeSlideIn 300ms ease-out', whiteSpace:'nowrap' }}>
          {successToast}
        </div>
      )}

      {/* ── GLOBAL STYLES ──────────────────────────────────── */}
      <style>{`
        @keyframes blink       { 0%,50%{opacity:1} 51%,100%{opacity:0} }
        @keyframes fadeSlideIn { from{opacity:0;transform:translateY(8px) translateX(-50%)} to{opacity:1;transform:translateY(0) translateX(-50%)} }
        @keyframes msgFadeIn   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }        @keyframes fadeIn      { from{opacity:0} to{opacity:1} }
        @keyframes slideUp     { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes kiwiSpin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes kiwiPulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes pulse       { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
        textarea::placeholder  { color:#4A5E4A; font-style:italic; }
        * { -webkit-font-smoothing:antialiased; box-sizing:border-box; }
        ::-webkit-scrollbar       { width:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#222D22; border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:#4A5E4A; }
      `}</style>
    </div>
  );
}

// ── Sidebar Item ─────────────────────────────────────────────
function SidebarItem({ chat, active, isRenaming, renameValue, renameInputRef, onRenameChange, onRenameCommit, onClick, onContextMenu, showStar=false, theme }: {
  chat: ChatSession; active: boolean; isRenaming: boolean;
  renameValue: string; renameInputRef: React.RefObject<HTMLInputElement|null>;
  onRenameChange:(v:string)=>void; onRenameCommit:()=>void;
  onClick:()=>void; onContextMenu:(e:React.MouseEvent)=>void;
  showStar?: boolean;
  theme: any;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ padding:'8px 10px', borderRadius:6, cursor:'pointer', fontSize:13, color:active?'#E8EDE8':theme.sub, background:active?'#1A2019':'transparent', display:'flex', alignItems:'center', gap:8, transition:'background 150ms', marginBottom:2, borderLeft:active?'2px solid #52B788':'2px solid transparent' }}
      onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='rgba(82,183,136,0.06)';}}
      onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='transparent';}}
    >
      {showStar && <span style={{ color:'#52B788', flexShrink:0, fontSize:11 }}>★</span>}
      {isRenaming ? (
        <input ref={renameInputRef} value={renameValue}
            onChange={e=>onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape')onRenameCommit();}}
          onClick={e=>e.stopPropagation()}
          style={{ flex:1, background:'#0C0E0D', border:'1px solid #52B788', borderRadius:4, padding:'2px 6px', color:'#E8EDE8', fontSize:12, fontFamily:"'DM Sans', sans-serif", outline:'none' }}
        />
      ) : (
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{chat.title}</span>
      )}
    </div>
  );
}