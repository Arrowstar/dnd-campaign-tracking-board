'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, Swords, Globe, LogOut, Plus, ChevronRight,
  Loader2, AlertCircle, UserPlus, LogIn, Users, KeyRound, Crown, Upload, ArrowLeftRight,
} from 'lucide-react';
import UserSettingsModal from '@/components/UserSettingsModal';
import TransferDmModal from '@/components/TransferDmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionData {
  sessionToken: string;
  userId: string;
  displayName: string;
}

interface BoardEntry {
  boardId: string;
  role: 'dm' | 'player';
  joinedAt: string;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // Auth form
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // Lobby
  const [myBoards, setMyBoards] = useState<BoardEntry[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);
  const [lobbyView, setLobbyView] = useState<'boards' | 'join' | 'create' | 'import'>('boards');

  // Join form
  const [joinBoardId, setJoinBoardId] = useState('');
  const [joinBoardPassword, setJoinBoardPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // Modals
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [transferBoard, setTransferBoard] = useState<BoardEntry | null>(null);

  // Create form
  const [createBoardId, setCreateBoardId] = useState('');
  const [createBoardPassword, setCreateBoardPassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Import form
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBoardId, setImportBoardId] = useState('');
  const [importBoardPassword, setImportBoardPassword] = useState('');
  const [importError, setImportError] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // ── Session check on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const raw = localStorage.getItem('dnd_session');
    if (!raw) { // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoadingSession(false); return; }

    let parsed: { sessionToken?: string } = {};
    try { parsed = JSON.parse(raw); } catch {  
      setIsLoadingSession(false); return; }

    if (!parsed.sessionToken) {  
      setIsLoadingSession(false); return; }

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${parsed.sessionToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) {
          setSession({ sessionToken: parsed.sessionToken!, userId: data.user.id, displayName: data.user.displayName });
        } else {
          localStorage.removeItem('dnd_session');
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingSession(false));
  }, []);

  // ── Load boards when session changes ──────────────────────────────────────
  const loadBoards = useCallback(() => {
    if (!session) return;
    setIsLoadingBoards(true);
    fetch('/api/auth/my-boards', { headers: { Authorization: `Bearer ${session.sessionToken}` } })
      .then(r => r.json())
      .then(data => setMyBoards(data.boards || []))
      .catch(() => {})
      .finally(() => setIsLoadingBoards(false));
  }, [session]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadBoards(); }, [loadBoards]);

  // ── Share-view "Request to join" prefill (?join=<boardId>, Feature 09) ─────
  // From the read-only view page's join CTA: drop straight into the join form
  // with the board id filled in. Cleaned from the URL so it can't re-trigger.
  useEffect(() => {
    const joinParam = new URLSearchParams(window.location.search).get('join');
    if (!joinParam) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJoinBoardId(joinParam.trim().toLowerCase());
    setLobbyView('join');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // ── Auth submit ────────────────────────────────────────────────────────────
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (authTab === 'register' && password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }
    setIsSubmittingAuth(true);
    try {
      const res = await fetch(`/api/auth/${authTab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Something went wrong.'); return; }
      const s: SessionData = {
        sessionToken: data.sessionToken,
        userId: data.user.id,
        displayName: data.user.displayName,
      };
      localStorage.setItem('dnd_session', JSON.stringify({ sessionToken: s.sessionToken }));
      setSession(s);
    } catch {
      setAuthError('Network error. Please try again.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  // ── Join board ─────────────────────────────────────────────────────────────
  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setJoinError('');
    setIsJoining(true);
    const cleanId = joinBoardId.trim().toLowerCase();
    try {
      const res = await fetch(`/api/boards/${cleanId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.sessionToken}` },
        body: JSON.stringify({ boardPassword: joinBoardPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setJoinError(data.error || 'Failed to join board.'); return; }
      router.push(`/board/${cleanId}`);
    } catch {
      setJoinError('Network error. Please try again.');
    } finally {
      setIsJoining(false);
    }
  };

  // ── Create board ───────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setCreateError('');
    setIsCreating(true);
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.sessionToken}` },
        body: JSON.stringify({
          boardId: createBoardId.trim().toLowerCase(),
          boardPassword: createBoardPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error || 'Failed to create board.'); return; }
      router.push(`/board/${data.boardId}`);
    } catch {
      setCreateError('Network error. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  // ── Import board from JSON ────────────────────────────────────────────────
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!importFile) { setImportError('Choose a board export (.json) file first.'); return; }
    setImportError('');
    setIsImporting(true);
    try {
      const text = await importFile.text();
      let parsed: { app?: string; schemaVersion?: number; board?: { id?: string } } = {};
      try { parsed = JSON.parse(text); } catch { setImportError('That file is not valid JSON.'); return; }

      if (parsed.app !== 'mythos-canvas') {
        setImportError('That file is not a Mythos Canvas board export.');
        return;
      }
      if (parsed.schemaVersion !== 1) {
        setImportError(
          parsed.schemaVersion && parsed.schemaVersion > 1
            ? 'This file was exported by a newer version of Mythos Canvas. Please update the app and try again.'
            : 'That export file has an unsupported version.'
        );
        return;
      }

      const sourceBoardId = typeof parsed.board?.id === 'string' ? parsed.board.id : 'import';
      const res = await fetch(`/api/boards/${sourceBoardId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.sessionToken}` },
        body: JSON.stringify({
          ...parsed,
          newBoardId: importBoardId.trim().toLowerCase() || undefined,
          boardPassword: importBoardPassword || undefined,
        }),
      });

      const responseText = await res.text();
      let data: { error?: string; boardId?: string } | null = null;
      try { data = JSON.parse(responseText); } catch { /* platform error (e.g. oversized body) */ }

      if (!res.ok) {
        if (res.status === 413 || !data) {
          setImportError('Import file is too large. Maximum size is 10 MB.');
          return;
        }
        setImportError(data.error || 'Failed to import board.');
        return;
      }

      router.push(`/board/${data?.boardId}`);
    } catch {
      setImportError('Network error. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  // ── Logout ─────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    if (session) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('dnd_session');
    setSession(null);
    setMyBoards([]);
    setLobbyView('boards');
  };

  // ── Loading splash ─────────────────────────────────────────────────────────
  if (isLoadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1C1814 0%, #2C2420 50%, #1C1814 100%)' }}>
        <Loader2 size={32} className="animate-spin text-[#B58D3D]" />
      </div>
    );
  }

  // ── Auth screen ────────────────────────────────────────────────────────────
  if (!session) {
    return <AuthScreen
      authTab={authTab} setAuthTab={(t) => { setAuthTab(t); setAuthError(''); }}
      username={username} setUsername={setUsername}
      password={password} setPassword={setPassword}
      confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
      authError={authError} isSubmitting={isSubmittingAuth}
      onSubmit={handleAuth}
    />;
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col font-sans" style={{ background: 'linear-gradient(135deg, #1C1814 0%, #2C2420 50%, #1C1814 100%)' }}>
      {/* Top bar */}
      <header className="h-16 flex items-center justify-between px-6 flex-shrink-0" style={{ borderBottom: '1px solid rgba(181,141,61,0.25)', background: 'rgba(28,24,20,0.8)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center font-serif text-xl font-bold italic text-[#E0D8D0]" style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)' }}>M</div>
          <div>
            <h1 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-none">Mythos Canvas</h1>
            <p className="text-[#8C7B6E] text-[11px] leading-none mt-0.5">D&D Campaign Tracker</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(181,141,61,0.12)', border: '1px solid rgba(181,141,61,0.25)' }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-[#1C1814]" style={{ background: 'linear-gradient(135deg, #B58D3D, #D4A84B)' }}>
              {session.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-[#C9C0B1] text-sm font-semibold">{session.displayName}</span>
          </div>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 text-sm transition-colors cursor-pointer"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            title="Account Settings & Password"
          >
            <KeyRound size={14} />
            <span>Settings</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 text-sm transition-colors cursor-pointer"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex gap-0 overflow-hidden">
        {/* Sidebar — My Campaigns */}
        <aside className="w-72 flex-shrink-0 flex flex-col overflow-hidden" style={{ borderRight: '1px solid rgba(181,141,61,0.15)', background: 'rgba(28,24,20,0.6)' }}>
          <div className="px-5 py-4 flex-shrink-0">
            <h2 className="text-[#B58D3D] text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-2">
              <Shield size={12} />My Campaigns
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
            {isLoadingBoards ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#B58D3D]" />
              </div>
            ) : myBoards.length === 0 ? (
              <div className="text-center py-10 px-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(181,141,61,0.1)', border: '1px solid rgba(181,141,61,0.2)' }}>
                  <Globe size={22} className="text-[#B58D3D] opacity-60" />
                </div>
                <p className="text-[#8C7B6E] text-xs leading-relaxed">No campaigns yet.<br/>Join or create one to get started.</p>
              </div>
            ) : (
              myBoards
                .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())
                .map(b => (
                  <BoardCard
                    key={b.boardId}
                    board={b}
                    onEnter={() => router.push(`/board/${b.boardId}`)}
                    onTransfer={b.role === 'dm' ? setTransferBoard : undefined}
                  />
                ))
            )}
          </div>

          {/* Sidebar actions */}
          <div className="p-3 flex-shrink-0 space-y-1.5" style={{ borderTop: '1px solid rgba(181,141,61,0.15)' }}>
            <button
              onClick={() => setLobbyView('join')}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${lobbyView === 'join' ? 'text-[#B58D3D]' : 'text-[#A89F91] hover:text-[#E0D8D0]'}`}
              style={{ background: lobbyView === 'join' ? 'rgba(181,141,61,0.12)' : 'transparent', border: '1px solid ' + (lobbyView === 'join' ? 'rgba(181,141,61,0.3)' : 'transparent') }}
            >
              <Swords size={15} />Join a Campaign
            </button>
            <button
              onClick={() => setLobbyView('create')}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${lobbyView === 'create' ? 'text-[#B58D3D]' : 'text-[#A89F91] hover:text-[#E0D8D0]'}`}
              style={{ background: lobbyView === 'create' ? 'rgba(181,141,61,0.12)' : 'transparent', border: '1px solid ' + (lobbyView === 'create' ? 'rgba(181,141,61,0.3)' : 'transparent') }}
            >
              <Plus size={15} />Create a Campaign
            </button>
            <button
              onClick={() => setLobbyView('import')}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${lobbyView === 'import' ? 'text-[#B58D3D]' : 'text-[#A89F91] hover:text-[#E0D8D0]'}`}
              style={{ background: lobbyView === 'import' ? 'rgba(181,141,61,0.12)' : 'transparent', border: '1px solid ' + (lobbyView === 'import' ? 'rgba(181,141,61,0.3)' : 'transparent') }}
            >
              <Upload size={15} />Import from JSON
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
          {lobbyView === 'boards' && (
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: 'linear-gradient(135deg, rgba(181,141,61,0.2), rgba(181,141,61,0.05))', border: '1px solid rgba(181,141,61,0.25)' }}>
                <Shield size={36} className="text-[#B58D3D]" />
              </div>
              <h2 className="text-2xl font-serif font-bold italic text-[#E0D8D0] mb-2">
                Welcome back, {session.displayName}
              </h2>
              <p className="text-[#8C7B6E] text-sm leading-relaxed mb-6">
                Select a campaign from the sidebar, or join / create one to begin your adventure.
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => setLobbyView('join')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer transition-all hover:scale-105" style={{ background: 'rgba(181,141,61,0.15)', border: '1px solid rgba(181,141,61,0.3)', color: '#B58D3D' }}>
                  <Swords size={14} />Join Campaign
                </button>
                <button onClick={() => setLobbyView('create')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold cursor-pointer transition-all hover:scale-105" style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814' }}>
                  <Plus size={14} />Create Campaign
                </button>
              </div>
            </div>
          )}

          {lobbyView === 'join' && (
            <FormCard title="Join a Campaign" icon={<Swords size={20} className="text-[#B58D3D]" />}>
              <form onSubmit={handleJoin} className="space-y-4">
                <FormField label="Campaign Board ID" hint="Ask your DM for this">
                  <input
                    type="text"
                    value={joinBoardId}
                    onChange={e => setJoinBoardId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. curse-of-strahd"
                    className="lobby-input"
                    required
                  />
                </FormField>

                <FormField label="Board Password" hint="Leave blank if not required">
                  <input
                    type="password"
                    value={joinBoardPassword}
                    onChange={e => setJoinBoardPassword(e.target.value)}
                    placeholder="Optional"
                    className="lobby-input"
                  />
                </FormField>

                {joinError && <ErrorBox>{joinError}</ErrorBox>}

                <SubmitButton isLoading={isJoining} label="Enter Campaign" loadingLabel="Joining..." />
              </form>
            </FormCard>
          )}

          {lobbyView === 'create' && (
            <FormCard title="Create a Campaign" icon={<Shield size={20} className="text-[#B58D3D]" />}>
              <form onSubmit={handleCreate} className="space-y-4">
                <FormField label="Campaign Board ID" hint="Lowercase letters, numbers, hyphens only">
                  <input
                    type="text"
                    value={createBoardId}
                    onChange={e => setCreateBoardId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. lost-mines-of-phandelver"
                    className="lobby-input"
                    required
                  />
                </FormField>
                <FormField label="Board Password" hint="Optional — players will need this to join">
                  <input
                    type="password"
                    value={createBoardPassword}
                    onChange={e => setCreateBoardPassword(e.target.value)}
                    placeholder="Optional"
                    className="lobby-input"
                  />
                </FormField>

                {createError && <ErrorBox>{createError}</ErrorBox>}

                <SubmitButton isLoading={isCreating} label="Create Campaign" loadingLabel="Creating..." />
                <button
                  type="button"
                  onClick={() => setLobbyView('import')}
                  className="w-full text-center text-xs text-[#8C7B6E] hover:text-[#B58D3D] transition-colors cursor-pointer"
                >
                  Or import a board from a JSON export
                </button>
              </form>
            </FormCard>
          )}

          {lobbyView === 'import' && (
            <FormCard title="Import a Campaign" icon={<Upload size={20} className="text-[#B58D3D]" />}>
              <form onSubmit={handleImport} className="space-y-4">
                <FormField label="Board Export File" hint=".json exported from another board">
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={e => setImportFile(e.target.files?.[0] || null)}
                    className="lobby-input cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1 file:text-xs file:font-bold file:cursor-pointer file:bg-[#B58D3D] file:text-[#1C1814]"
                  />
                </FormField>

                <FormField label="New Board ID" hint="Optional — defaults to the original board's ID">
                  <input
                    type="text"
                    value={importBoardId}
                    onChange={e => setImportBoardId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. my-world-part-2"
                    className="lobby-input"
                  />
                </FormField>

                <FormField label="Board Password" hint="Optional — players will need this to join">
                  <input
                    type="password"
                    value={importBoardPassword}
                    onChange={e => setImportBoardPassword(e.target.value)}
                    placeholder="Optional"
                    className="lobby-input"
                  />
                </FormField>

                {importError && <ErrorBox>{importError}</ErrorBox>}

                <SubmitButton isLoading={isImporting} label="Import as New Board" loadingLabel="Importing..." />

                <p className="text-[11px] text-[#8C7B6E] leading-relaxed">
                  Creates a brand-new board owned by you — the original board is untouched. Members are
                  not copied. Images are preserved when importing on the same server as the export.
                </p>
              </form>
            </FormCard>
          )}
        </main>
      </div>

      <UserSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        sessionToken={session.sessionToken}
        username={session.displayName}
        onAccountDeleted={() => {
          setShowSettingsModal(false);
          setMyBoards([]);
          setSession(null);
        }}
      />

      <TransferDmModal
        isOpen={transferBoard !== null}
        onClose={() => setTransferBoard(null)}
        boardId={transferBoard?.boardId ?? ''}
        sessionToken={session.sessionToken}
        onTransferred={() => {
          setTransferBoard(null);
          loadBoards();
        }}
      />

      <style>{`
        .lobby-input {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(181,141,61,0.25);
          color: #E0D8D0;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s;
        }
        .lobby-input::placeholder { color: rgba(168,159,145,0.5); }
        .lobby-input:focus { border-color: #B58D3D; }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AuthScreen({
  authTab, setAuthTab,
  username, setUsername,
  password, setPassword,
  confirmPassword, setConfirmPassword,
  authError, isSubmitting, onSubmit,
}: {
  authTab: 'login' | 'register';
  setAuthTab: (t: 'login' | 'register') => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  authError: string;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans" style={{ background: 'linear-gradient(135deg, #1C1814 0%, #2C2420 50%, #1C1814 100%)' }}>
      {/* Decorative glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #B58D3D, transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 font-serif text-3xl font-bold italic text-[#E0D8D0]" style={{ background: 'linear-gradient(135deg, #B58D3D, #6B4E17)', boxShadow: '0 0 40px rgba(181,141,61,0.3)' }}>M</div>
          <h1 className="text-3xl font-serif font-bold italic text-[#E0D8D0] leading-tight">Mythos Canvas</h1>
          <p className="text-[#8C7B6E] text-sm mt-1">D&D Campaign Tracking Board</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: 'rgba(40,34,28,0.95)', border: '1px solid rgba(181,141,61,0.3)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          {/* Tabs */}
          <div className="flex rounded-xl overflow-hidden mb-6" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(181,141,61,0.15)' }}>
            {(['login', 'register'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setAuthTab(tab)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-all cursor-pointer ${authTab === tab ? 'text-[#1C1814]' : 'text-[#8C7B6E] hover:text-[#C9C0B1]'}`}
                style={{ background: authTab === tab ? 'linear-gradient(135deg, #B58D3D, #96722E)' : 'transparent', borderRadius: '10px', margin: '3px' }}
              >
                {tab === 'login' ? <LogIn size={14} /> : <UserPlus size={14} />}
                {tab === 'login' ? 'Sign In' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. Gandalf"
                required
                className="auth-input"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={authTab === 'register' ? 'At least 6 characters' : ''}
                required
                className="auth-input"
              />
            </div>
            {authTab === 'register' && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  className="auth-input"
                />
              </div>
            )}

            {authError && <ErrorBox>{authError}</ErrorBox>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              style={{ background: isSubmitting ? 'rgba(181,141,61,0.5)' : 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: isSubmitting ? 'none' : '0 4px 20px rgba(181,141,61,0.3)' }}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : (authTab === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />)}
              {isSubmitting ? 'Please wait...' : (authTab === 'login' ? 'Enter the Campaign' : 'Create Account')}
            </button>
          </form>
        </div>

        <p className="text-center text-[#8C7B6E] text-xs mt-5">
          {authTab === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={() => setAuthTab(authTab === 'login' ? 'register' : 'login')} className="text-[#B58D3D] hover:underline cursor-pointer font-semibold">
            {authTab === 'login' ? 'Register here' : 'Sign in'}
          </button>
        </p>
      </div>

      <style>{`
        .auth-input {
          width: 100%;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(181,141,61,0.25);
          color: #E0D8D0;
          padding: 11px 14px;
          border-radius: 10px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .auth-input::placeholder { color: rgba(168,159,145,0.4); }
        .auth-input:focus { border-color: #B58D3D; background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  );
}

function BoardCard({ board, onEnter, onTransfer }: { board: BoardEntry; onEnter: () => void; onTransfer?: (b: BoardEntry) => void }) {
  const isDM = board.role === 'dm';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEnter}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEnter(); } }}
      className="w-full rounded-xl group flex items-center gap-1 transition-all cursor-pointer"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(181,141,61,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(181,141,61,0.25)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
    >
      <div className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isDM ? '' : ''}`} style={{ background: isDM ? 'rgba(181,141,61,0.2)' : 'rgba(99,102,241,0.2)' }}>
          {isDM ? <Crown size={14} className="text-[#B58D3D]" /> : <Users size={14} className="text-indigo-400" />}
        </div>
        <div className="min-w-0">
          <p className="text-[#E0D8D0] text-sm font-bold truncate">{board.boardId}</p>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${isDM ? 'text-[#B58D3D]' : 'text-indigo-400'}`}>
            {isDM ? 'Dungeon Master' : 'Player'}
          </p>
        </div>
      </div>
      {isDM && onTransfer && (
        <button
          type="button"
          title="Transfer DM role and leave this board"
          onClick={(e) => { e.stopPropagation(); onTransfer(board); }}
          className="mr-1 w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#B58D3D] hover:bg-[rgba(181,141,61,0.15)] transition-colors cursor-pointer"
        >
          <ArrowLeftRight size={13} />
        </button>
      )}
      <ChevronRight size={14} className="text-[#8C7B6E] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mr-2" />
    </div>
  );
}

function FormCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'rgba(40,34,28,0.95)', border: '1px solid rgba(181,141,61,0.25)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
      <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}>
        {icon}
        <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E]">{label}</label>
        {hint && <span className="text-[10px] text-[#8C7B6E] opacity-70 italic">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}>
      <AlertCircle size={14} className="flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function SubmitButton({ isLoading, label, loadingLabel }: { isLoading: boolean; label: string; loadingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={isLoading}
      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ background: isLoading ? 'rgba(181,141,61,0.5)' : 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: isLoading ? 'none' : '0 4px 16px rgba(181,141,61,0.25)' }}
    >
      {isLoading && <Loader2 size={15} className="animate-spin" />}
      {isLoading ? loadingLabel : label}
    </button>
  );
}
