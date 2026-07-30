'use client';

import { useState } from 'react';
import { X, Lock, CheckCircle2, AlertCircle, Loader2, KeyRound } from 'lucide-react';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionToken: string;
  username: string;
}

export default function UserSettingsModal({ isOpen, onClose, sessionToken, username }: UserSettingsModalProps) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update password.');
      } else {
        setSuccess('Password updated successfully!');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center gap-2.5">
            <KeyRound size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Account Settings</h2>
              <p className="text-[#8C7B6E] text-xs">Logged in as <span className="text-[#C9C0B1] font-semibold">{username}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">Current Password</label>
            <input
              type="password"
              value={oldPassword}
              onChange={e => setOldPassword(e.target.value)}
              placeholder="Enter current password"
              required
              className="modal-input"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              className="modal-input"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E] mb-1.5">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              required
              className="modal-input"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}>
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#86EFAC' }}>
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: '0 4px 16px rgba(181,141,61,0.25)' }}
            >
              {isLoading && <Loader2 size={15} className="animate-spin" />}
              {isLoading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .modal-input {
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
        .modal-input::placeholder { color: rgba(168,159,145,0.4); }
        .modal-input:focus { border-color: #B58D3D; background: rgba(255,255,255,0.08); }
      `}</style>
    </div>
  );
}
