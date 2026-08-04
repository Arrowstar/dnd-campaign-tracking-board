'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Link2, Copy, Check, Trash2, Loader2, AlertCircle, Clock, ShieldAlert, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ShareLink } from '@/lib/types';

interface ShareLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
}

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Feature 09 — DM link management: create named read-only view links with
 * optional expiry, copy the share URL, revoke individually. The full URL is
 * built at copy time from window.location.origin so it works in dev and prod.
 */
export default function ShareLinksModal({ isOpen, onClose, boardId }: ShareLinksModalProps) {
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const linkPath = useCallback((token: string) => `/board/${boardId}/view/${token}`, [boardId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/boards/${boardId}/shares`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Failed to load share links.');
        return;
      }
      const data = await res.json();
      setShares((data.shares || []) as ShareLink[]);
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabel('');
    setExpiresInDays('');
    setCopiedToken(null);
    setConfirmRevoke(null);
    setError('');
    load();
  }, [isOpen, load]);

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}${linkPath(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(prev => (prev === token ? null : prev)), 2000);
    } catch {
      setError('Could not copy to clipboard. Select the URL manually.');
    }
  };

  const handleCreate = async () => {
    setError('');
    setCreating(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || undefined,
          expiresInDays: expiresInDays === '' ? null : Number(expiresInDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create share link.');
        return;
      }
      setShares(prev => [
        { token: data.token, label: data.label, createdAt: new Date().toISOString(), expiresAt: data.expiresAt ?? null },
        ...prev,
      ]);
      setLabel('');
      setExpiresInDays('');
      handleCopy(data.token);
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: string) => {
    setError('');
    try {
      const res = await fetch(`/api/boards/${boardId}/shares/${token}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Failed to revoke share link.');
        return;
      }
      setShares(prev => prev.filter(s => s.token !== token));
      setConfirmRevoke(null);
    } catch {
      setError('A network error occurred. Please try again.');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex items-center gap-2.5">
            <Link2 size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Share Links</h2>
              <p className="text-[#8C7B6E] text-xs">Read-only view links — no login required</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Create link form */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Plus size={15} className="text-[#B58D3D]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B58D3D]">Create link</span>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E]">
                  Label <span className="font-normal normal-case tracking-normal opacity-70">(optional)</span>
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={40}
                  placeholder="e.g. Party map link"
                  className="w-full bg-[#FDFAF6] border border-[#D9D0C1] rounded-lg px-3 py-2 text-sm text-[#2C2824] placeholder-[#A89F91] focus:border-[#B58D3D] outline-none transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E]">Expires</label>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  className="w-full bg-[#FDFAF6] border border-[#D9D0C1] rounded-lg px-3 py-2 text-sm text-[#2C2824] focus:border-[#B58D3D] outline-none transition-colors cursor-pointer"
                >
                  {EXPIRY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: '0 4px 16px rgba(181,141,61,0.25)' }}
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
                {creating ? 'Creating…' : 'Create share link'}
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-[#8C7B6E] leading-relaxed mt-3">
              <ShieldAlert size={13} className="flex-shrink-0 mt-0.5 text-[#B58D3D]" />
              Anyone with the link can view the board without an account or the board password.
              DM-only and owner-only items are never shown.
            </p>
          </div>

          {/* Link list */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={15} className="text-[#B58D3D]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B58D3D]">Active links</span>
              <span className="text-[10px] text-[#8C7B6E]">{shares.length}/20</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[#8C7B6E] text-sm">
                <Loader2 size={15} className="animate-spin" /> Loading…
              </div>
            ) : shares.length === 0 ? (
              <div className="text-sm italic text-[#8C7B6E] py-4 text-center border border-dashed border-[#8C7B6E]/30 rounded-lg">
                No share links yet. Create one above and text the URL to your players.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {shares.map(s => (
                  <div
                    key={s.token}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                    style={{ background: 'rgba(181,141,61,0.08)', border: '1px solid rgba(181,141,61,0.2)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[#E0D8D0] truncate">{s.label}</div>
                      <div className="text-[10px] text-[#8C7B6E]">
                        Created {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                        {' · '}
                        {s.expiresAt ? `Expires ${formatDate(s.expiresAt)}` : 'Never expires'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy(s.token)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                      style={copiedToken === s.token
                        ? { background: 'rgba(34,197,94,0.15)', color: '#86EFAC' }
                        : { background: 'rgba(181,141,61,0.15)', color: '#B58D3D' }}
                      title="Copy link"
                    >
                      {copiedToken === s.token ? <Check size={13} /> : <Copy size={13} />}
                      {copiedToken === s.token ? 'Copied!' : 'Copy'}
                    </button>
                    {confirmRevoke === s.token ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRevoke(s.token)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white transition-colors cursor-pointer"
                        >
                          Revoke
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevoke(null)}
                          className="px-2 py-1.5 rounded-lg text-[11px] font-bold text-[#8C7B6E] hover:text-[#E0D8D0] transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(s.token)}
                        className="p-1.5 rounded-lg text-[#8C7B6E] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title="Revoke link — it stops working immediately"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
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
        <div className="flex justify-end px-6 py-4" style={{ borderTop: '1px solid rgba(181,141,61,0.15)' }}>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
