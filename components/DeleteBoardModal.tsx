'use client';

import { useEffect, useState } from 'react';
import { X, AlertTriangle, Trash2, Loader2, AlertCircle, Download, CheckCircle2 } from 'lucide-react';
import { downloadBoardExport } from '@/lib/exportImport';

interface DeleteBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
}

interface MemberRow {
  id: string;
  displayName: string;
  username: string;
  role: 'dm' | 'player';
}

/**
 * Feature 07 — board deletion confirm. The user must type the board id exactly
 * before the destructive button enables (confirm-by-typed-id; board ids are
 * `[a-z0-9-]` slugs, so comparison is case-insensitive by construction).
 */
export default function DeleteBoardModal({ isOpen, onClose, boardId }: DeleteBoardModalProps) {
  const [typedId, setTypedId] = useState('');
  const [otherMembers, setOtherMembers] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTypedId('');
    setError('');
    setExportMsg('');
    setOtherMembers(null);
    let cancelled = false;
    fetch(`/api/boards/${boardId}/members`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { members?: MemberRow[] } | null) => {
        if (cancelled || !data?.members) return;
        setOtherMembers(Math.max(0, data.members.length - 1));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, boardId]);

  if (!isOpen) return null;

  const matches = typedId.trim().toLowerCase() === boardId;

  const handleExport = async () => {
    setExportMsg('');
    setError('');
    setIsExporting(true);
    try {
      const err = await downloadBoardExport(boardId);
      setExportMsg(err ? '' : 'Backup downloaded.');
      if (err) setError(err);
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!matches || isDeleting) return;
    setError('');
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Failed to delete the board.');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('A network error occurred. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !isDeleting) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl transition-all"
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
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Delete campaign board</h2>
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
        <div className="p-6 space-y-4">
          <div
            className="p-3 rounded-lg text-sm font-mono"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}
          >
            <span className="text-[#8C7B6E]">Board:</span> {boardId}
            {otherMembers !== null && (
              <div className="mt-1 text-xs text-[#FCA5A5]/80">
                {otherMembers === 0
                  ? 'You are the only member.'
                  : `${otherMembers} other member${otherMembers === 1 ? '' : 's'} will lose access immediately.`}
              </div>
            )}
          </div>

          <ul className="text-xs text-[#8C7B6E] leading-relaxed space-y-1 list-disc pl-4">
            <li>All cards, tabs, connections, annotations, and comments are permanently deleted.</li>
            <li>Board history, share links, and notifications are deleted too.</li>
          </ul>

          <div
            className="p-3 rounded-lg"
            style={{ background: 'rgba(181,141,61,0.1)', border: '1px solid rgba(181,141,61,0.3)' }}
          >
            <p className="text-[11px] text-[#C9C0B1] mb-2 flex items-center gap-1.5">
              <Download size={13} className="text-[#B58D3D]" />
              Tip: Export a JSON backup first.
            </p>
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer disabled:opacity-60"
              style={{ background: 'rgba(181,141,61,0.15)', border: '1px solid rgba(181,141,61,0.35)', color: '#B58D3D' }}
            >
              {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {isExporting ? 'Exporting…' : 'Export board'}
            </button>
            {exportMsg && (
              <p className="mt-1.5 text-[11px] flex items-center gap-1 text-[#86EFAC]">
                <CheckCircle2 size={12} /> {exportMsg} You can still cancel.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">
              Type the board id to confirm
            </label>
            <input
              type="text"
              value={typedId}
              onChange={(e) => setTypedId(e.target.value)}
              placeholder={boardId}
              disabled={isDeleting}
              autoFocus
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(239,68,68,0.25)] text-[#E0D8D0] px-3 py-2.5 rounded-lg text-sm font-mono outline-none focus:border-[#F87171] disabled:opacity-50"
            />
          </div>

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
            disabled={!matches || isDeleting}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: matches && !isDeleting ? 'linear-gradient(135deg, #DC2626, #991B1B)' : 'rgba(239,68,68,0.2)',
              color: '#FFF1F1',
            }}
          >
            {isDeleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            {isDeleting ? 'Deleting…' : 'Delete board'}
          </button>
        </div>
      </div>
    </div>
  );
}
