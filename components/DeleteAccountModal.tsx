'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { findBlockingBoards } from '@/lib/accountDeletion';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionToken: string;
  /** Account username — the user must type it to confirm. */
  username: string;
  onAccountDeleted: () => void;
}

interface DmBoardRow {
  boardId: string;
  memberCount: number;
  otherMembers: number;
  hasOthers: boolean;
}

interface MemberBoardRow {
  boardId: string;
  dmName?: string;
  ownedItems: number;
}

interface DeletionSummaryPayload {
  dmBoards: DmBoardRow[];
  memberBoards: MemberBoardRow[];
  ownedItemsOnOtherBoards: number;
}

/**
 * Feature 07 — account deletion, two steps:
 *  1. Summary screen from GET /api/auth/account/deletion-summary. DM boards
 *     with other members are optional (checked = deleted); unchecked ones
 *     block deletion until resolved. Solo DM boards are shown as "will be
 *     deleted" — they can't be left in limbo.
 *  2. DELETE /api/auth/account with { confirmed: true, deleteBoardIds }.
 *     On success the session is cleared locally; the lobby falls back to the
 *     auth screen.
 */
export default function DeleteAccountModal({ isOpen, onClose, sessionToken, username, onAccountDeleted }: DeleteAccountModalProps) {
  const [summary, setSummary] = useState<DeletionSummaryPayload | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [typedUsername, setTypedUsername] = useState('');
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(null);
    setChecked(new Set());
    setTypedUsername('');
    setError('');
    let cancelled = false;
    fetch('/api/auth/account/deletion-summary', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: DeletionSummaryPayload | null) => {
        if (!cancelled && data) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load the deletion summary. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionToken]);

  const deleteBoardIds = useMemo(() => Array.from(checked), [checked]);

  const blockingBoards = useMemo(
    () => (summary ? findBlockingBoards(summary.dmBoards, deleteBoardIds) : []),
    [summary, deleteBoardIds]
  );

  if (!isOpen) return null;

  const usernameMatches = typedUsername.trim().toLowerCase() === username.trim().toLowerCase();
  const canDelete = usernameMatches && blockingBoards.length === 0 && !isDeleting;

  const toggle = (boardId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    setError('');
    setIsDeleting(true);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ confirmed: true, deleteBoardIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(data?.blockingBoards)) {
          setError(
            `Account not deleted. Resolve these boards first: ${data.blockingBoards
              .map((b: { boardId: string }) => b.boardId)
              .join(', ')}.`
          );
        } else {
          setError(data?.error || 'Failed to delete the account.');
        }
        setIsDeleting(false);
        return;
      }
      localStorage.removeItem('dnd_session');
      onAccountDeleted();
    } catch {
      setError('A network error occurred. Please try again.');
      setIsDeleting(false);
    }
  };

  const optOutBoards = (summary?.dmBoards || []).filter((b) => b.hasOthers);
  const soloBoards = (summary?.dmBoards || []).filter((b) => !b.hasOthers);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(239,68,68,0.35)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(239,68,68,0.2)', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={20} className="text-[#F87171]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Delete account</h2>
              <p className="text-[#8C7B6E] text-xs">This cannot be undone</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
            title="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {!summary ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-[#B58D3D]" />
            </div>
          ) : (
            <>
              {/* DM boards */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#F87171] mb-2">
                  You are DM on {summary.dmBoards.length} board{summary.dmBoards.length === 1 ? '' : 's'}
                </p>

                {optOutBoards.map((b) => {
                  const isChecked = checked.has(b.boardId);
                  return (
                    <label
                      key={b.boardId}
                      className="flex items-start gap-2.5 p-3 rounded-lg mb-1.5 cursor-pointer transition-colors"
                      style={{ background: isChecked ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(b.boardId)}
                        className="mt-0.5 accent-[#F87171]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#E0D8D0] truncate">
                          {isChecked ? `Also delete "${b.boardId}"` : `"${b.boardId}" — delete this board too`}
                        </p>
                        <p className="text-[11px] text-[#8C7B6E] mt-0.5">
                          {b.otherMembers} other member{b.otherMembers === 1 ? '' : 's'}
                          {!isChecked && (
                            <span className="block text-[#FCA5A5] mt-1">
                              You are the only DM. Delete it, or remove its members first, before deleting your account.
                            </span>
                          )}
                        </p>
                      </div>
                    </label>
                  );
                })}

                {soloBoards.map((b) => (
                  <div
                    key={b.boardId}
                    className="flex items-start gap-2.5 p-3 rounded-lg mb-1.5"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    <CheckCircle2 size={15} className="text-[#F87171] mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#E0D8D0] truncate">&quot;{b.boardId}&quot; — will be deleted</p>
                      <p className="text-[11px] text-[#8C7B6E] mt-0.5">
                        You are the only member, so this board has no one to leave it to.
                      </p>
                    </div>
                  </div>
                ))}

                {summary.dmBoards.length === 0 && (
                  <p className="text-[11px] text-[#8C7B6E]">You are not a Dungeon Master on any board.</p>
                )}
              </div>

              {/* Member boards */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#F87171] mb-2">
                  You are a member of {summary.memberBoards.length} other board{summary.memberBoards.length === 1 ? '' : 's'}
                </p>
                {summary.memberBoards.length === 0 ? (
                  <p className="text-[11px] text-[#8C7B6E]">No memberships.</p>
                ) : (
                  <ul className="text-xs text-[#8C7B6E] space-y-1 list-disc pl-4">
                    {summary.memberBoards.map((b) => (
                      <li key={b.boardId}>
                        <span className="text-[#C9C0B1] font-semibold">{b.boardId}</span>
                        {b.dmName ? ` (DM: ${b.dmName})` : ''}
                        {b.ownedItems > 0
                          ? ` — ${b.ownedItems} owned item${b.ownedItems === 1 ? '' : 's'} will be reassigned to the DM`
                          : ' — membership removed'}
                      </li>
                    ))}
                  </ul>
                )}
                {summary.ownedItemsOnOtherBoards > 0 && (
                  <p className="text-[11px] text-[#8C7B6E] mt-1.5">
                    {summary.ownedItemsOnOtherBoards} owned item{summary.ownedItemsOnOtherBoards === 1 ? '' : 's'} across these boards
                    will be transferred to each board&apos;s DM. Comments are kept as-is.
                  </p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">
              Type your username to confirm
            </label>
            <input
              type="text"
              value={typedUsername}
              onChange={(e) => setTypedUsername(e.target.value)}
              placeholder={username}
              disabled={isDeleting}
              autoFocus
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(239,68,68,0.25)] text-[#E0D8D0] px-3 py-2.5 rounded-lg text-sm outline-none focus:border-[#F87171] disabled:opacity-50"
            />
          </div>

          {blockingBoards.length > 0 && (
            <div
              className="flex items-start gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}
            >
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>
                Unchecked DM boards block deletion:{' '}
                {blockingBoards.map((b) => b.boardId).join(', ')}. Delete them or resolve their members first.
              </span>
            </div>
          )}

          {error && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}
            >
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid rgba(239,68,68,0.15)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: canDelete ? 'linear-gradient(135deg, #DC2626, #991B1B)' : 'rgba(239,68,68,0.2)',
              color: '#FFF1F1',
            }}
          >
            {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {isDeleting ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  );
}
