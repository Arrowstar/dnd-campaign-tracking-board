'use client';

import { useState, useEffect } from 'react';
import { X, Users, Crown, UserX, Loader2, AlertCircle, Shield, Check } from 'lucide-react';

export interface BoardMemberInfo {
  id: string;
  displayName: string;
  username: string;
  role: 'dm' | 'player';
  joinedAt: string;
}

interface MemberManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  sessionToken: string;
  currentUserId: string;
  currentUserRole: 'dm' | 'player';
}

export default function MemberManagementModal({
  isOpen,
  onClose,
  boardId,
  sessionToken,
  currentUserId,
  currentUserRole,
}: MemberManagementModalProps) {
  const [members, setMembers] = useState<BoardMemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [kickingId, setKickingId] = useState<string | null>(null);

  const fetchMembers = () => {
    setIsLoading(true);
    setError('');
    fetch(`/api/boards/${boardId}/members`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.members) setMembers(data.members);
        else setError(data.error || 'Failed to load members.');
      })
      .catch(() => setError('Failed to fetch members list.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (isOpen) fetchMembers();
  }, [isOpen, boardId]);

  if (!isOpen) return null;

  const handleKick = async (member: BoardMemberInfo) => {
    if (!confirm(`Are you sure you want to remove "${member.displayName}" from this campaign?`)) return;

    setKickingId(member.id);
    try {
      const res = await fetch(`/api/boards/${boardId}/members/${member.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to remove member.');
      } else {
        setMembers(prev => prev.filter(m => m.id !== member.id));
      }
    } catch {
      alert('Network error while removing member.');
    } finally {
      setKickingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center gap-2.5">
            <Users size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Campaign Members</h2>
              <p className="text-[#8C7B6E] text-xs">Board: <span className="text-[#C9C0B1] font-semibold">{boardId}</span></p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Members List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-[#B58D3D]" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : (
            members.map(member => {
              const isDM = member.role === 'dm';
              const isSelf = member.id === currentUserId;

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 rounded-xl transition-all"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: isDM ? 'rgba(181,141,61,0.2)' : 'rgba(99,102,241,0.2)' }}
                    >
                      {isDM ? <Crown size={16} className="text-[#B58D3D]" /> : <Users size={16} className="text-indigo-400" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#E0D8D0] text-sm font-bold">{member.displayName}</span>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-[#8C7B6E]">You</span>
                        )}
                      </div>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDM ? 'text-[#B58D3D]' : 'text-indigo-400'}`}>
                        {isDM ? 'Dungeon Master' : 'Player'}
                      </span>
                    </div>
                  </div>

                  {currentUserRole === 'dm' && !isSelf && !isDM && (
                    <button
                      onClick={() => handleKick(member)}
                      disabled={kickingId === member.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                      style={{ border: '1px solid rgba(239,68,68,0.2)' }}
                      title="Remove player from campaign"
                    >
                      {kickingId === member.id ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.1)' }}>
          <span className="text-xs text-[#8C7B6E]">Total members: {members.length}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
