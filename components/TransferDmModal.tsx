'use client';

import { useEffect, useState } from 'react';
import { X, Crown, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface TransferDmModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  sessionToken: string;
  onTransferred: () => void;
}

interface MemberRow {
  id: string;
  displayName: string;
  username: string;
  role: 'dm' | 'player';
}

/**
 * Feature 07 — "Transfer to…" for DM-owned boards in the lobby. The DM picks a
 * member, who becomes the new DM; the current DM then leaves the board.
 */
export default function TransferDmModal({ isOpen, onClose, boardId, sessionToken, onTransferred }: TransferDmModalProps) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [transferringId, setTransferringId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMembers(null);
    setError('');
    setSuccess('');
    let cancelled = false;
    fetch(`/api/boards/${boardId}/members`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { members?: MemberRow[] } | null) => {
        if (!cancelled && data?.members) setMembers(data.members);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load members.');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, boardId, sessionToken]);

  if (!isOpen) return null;

  const candidates = (members || []).filter((m) => m.role === 'player');

  const handleTransfer = async (target: MemberRow) => {
    if (transferringId) return;
    setError('');
    setSuccess('');
    setTransferringId(target.id);
    try {
      const res = await fetch(`/api/boards/${boardId}/members/${target.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Failed to transfer the DM role.');
        setTransferringId(null);
        return;
      }
      setSuccess(`DM role transferred to ${target.displayName}. You left the board.`);
      setTimeout(onTransferred, 900);
    } catch {
      setError('A network error occurred. Please try again.');
      setTransferringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex items-center gap-2.5">
            <Crown size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Transfer Dungeon Master</h2>
              <p className="text-[#8C7B6E] text-xs">{boardId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
            title="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3">
          <p className="text-[11px] text-[#8C7B6E] leading-relaxed">
            Choose who becomes the new DM. The new DM takes over the board and you leave it
            (your account and other boards are unaffected).
          </p>

          {!members ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[#B58D3D]" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-center text-[#8C7B6E] text-sm py-6">
              No other members on this board to transfer to.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {candidates.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleTransfer(m)}
                  disabled={transferringId !== null}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer disabled:opacity-60"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <span className="text-[#E0D8D0]">{m.displayName}</span>
                  {transferringId === m.id ? (
                    <Loader2 size={15} className="animate-spin text-[#B58D3D]" />
                  ) : (
                    <span className="text-[#B58D3D] text-xs font-bold">Transfer →</span>
                  )}
                </button>
              ))}
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
          {success && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#86EFAC' }}
            >
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
