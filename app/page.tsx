'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';

export default function Home() {
  const router = useRouter();
  const [boardId, setBoardId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [password, setPassword] = useState('');
  const [boardPassword, setBoardPassword] = useState('');
  const [joinAsDM, setJoinAsDM] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Initialize or load user ID
    const userStr = localStorage.getItem('dnd_user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (user.name) setName(user.name);
      } catch (e) {
        // Ignore
      }
    } else {
      const newId = uuidv4();
      localStorage.setItem('dnd_user', JSON.stringify({ id: newId }));
    }
  }, []);

  // Always issue a fresh UUID at login time so different players on the
  // same device don't accidentally inherit each other's identity.
  const getOrCreateUserId = () => {
    return uuidv4();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boardId || !name) return;
    setError('');
    setIsLoading(true);

    const userId = getOrCreateUserId();

    try {
      if (mode === 'join') {
        const res = await fetch(`/api/boards/${boardId}`);
        const data = await res.json();
        
        if (!data.exists) {
          setError('Board does not exist. Did you mean to create it?');
          setIsLoading(false);
          return;
        }

        let role: 'dm' | 'player' = 'player';

        if (joinAsDM) {
          const verifyRes = await fetch(`/api/boards/${boardId}/verify-dm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, userId })
          });
          if (!verifyRes.ok) {
            const verifyData = await verifyRes.json();
            setError(verifyData.error || 'Incorrect DM password.');
            setIsLoading(false);
            return;
          }
          role = 'dm';
        } else {
          if (data.requiresBoardPassword) {
            if (!boardPassword) {
              setError('This board requires a Board Password to join.');
              setIsLoading(false);
              return;
            }
            const verifyRes = await fetch(`/api/boards/${boardId}/verify-board`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ boardPassword })
            });
            if (!verifyRes.ok) {
              const verifyData = await verifyRes.json();
              setError(verifyData.error || 'Incorrect Board Password.');
              setIsLoading(false);
              return;
            }
          }
        }

        localStorage.setItem('dnd_user', JSON.stringify({ id: userId, name, role, boardId }));
        router.push(`/board/${boardId}`);
      } else {
        if (!password) {
          setError('A DM password is required to create a board.');
          setIsLoading(false);
          return;
        }

        const res = await fetch(`/api/boards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boardId, ownerId: userId, ownerName: name, password, boardPassword })
        });
        
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Failed to create board.');
          setIsLoading(false);
          return;
        }

        localStorage.setItem('dnd_user', JSON.stringify({ id: userId, name, role: 'dm', boardId }));
        router.push(`/board/${boardId}`);
      }
    } catch (err) {
      console.error(err);
      setError('A network error occurred.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl p-8 shadow-2xl border border-[#D9D0C1]">
        <h1 className="text-3xl font-bold text-[#2C2824] mb-2 text-center font-serif italic">Mythos Canvas</h1>
        <p className="text-[#8C7B6E] mb-8 text-center text-sm">A real-time D&D campaign tracking board.</p>

        <div className="flex rounded-lg overflow-hidden border border-[#D9D0C1] mb-6">
          <button
            onClick={() => { setMode('join'); setError(''); }}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${mode === 'join' ? 'bg-[#2C2824] text-[#E0D8D0]' : 'bg-[#EBE4D8] text-[#8C7B6E] hover:bg-[#D9D0C1]'}`}
          >
            Join Campaign
          </button>
          <button
            onClick={() => { setMode('create'); setError(''); }}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${mode === 'create' ? 'bg-[#2C2824] text-[#E0D8D0]' : 'bg-[#EBE4D8] text-[#8C7B6E] hover:bg-[#D9D0C1]'}`}
          >
            Create Campaign
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-[#423D38] mb-2 uppercase tracking-wider text-[10px]">Board ID</label>
            <input 
              type="text" 
              value={boardId}
              onChange={e => setBoardId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="w-full bg-[#EBE4D8] border border-[#D9D0C1] rounded-lg px-4 py-3 text-[#423D38] focus:outline-none focus:ring-2 focus:ring-[#B58D3D] focus:border-[#B58D3D] transition-colors"
              placeholder="e.g. curse-of-strahd"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-[#423D38] mb-2 uppercase tracking-wider text-[10px]">
              {mode === 'join' ? 'Your Name / Character Name' : 'Dungeon Master Name'}
            </label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#EBE4D8] border border-[#D9D0C1] rounded-lg px-4 py-3 text-[#423D38] focus:outline-none focus:ring-2 focus:ring-[#B58D3D] focus:border-[#B58D3D] transition-colors"
              placeholder={mode === 'join' ? 'e.g. Gandalf' : 'e.g. Matt Mercer'}
              required
            />
          </div>

          {mode === 'join' && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="joinAsDM"
                checked={joinAsDM}
                onChange={e => setJoinAsDM(e.target.checked)}
                className="w-4 h-4 text-[#B58D3D] bg-[#EBE4D8] border-[#D9D0C1] rounded focus:ring-[#B58D3D]"
              />
              <label htmlFor="joinAsDM" className="text-sm font-bold text-[#423D38]">
                Join as Dungeon Master
              </label>
            </div>
          )}

          {(mode === 'create' || joinAsDM) && (
            <div>
              <label className="block text-sm font-bold text-[#423D38] mb-2 uppercase tracking-wider text-[10px]">
                DM Password
              </label>
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#EBE4D8] border border-[#D9D0C1] rounded-lg px-4 py-3 text-[#423D38] focus:outline-none focus:ring-2 focus:ring-[#B58D3D] focus:border-[#B58D3D] transition-colors"
                placeholder="Required for DM access"
                required={mode === 'create' || joinAsDM}
              />
            </div>
          )}

          {(!joinAsDM) && (
            <div>
              <label className="block text-sm font-bold text-[#423D38] mb-2 uppercase tracking-wider text-[10px]">
                Board Password
              </label>
              <input 
                type="password" 
                value={boardPassword}
                onChange={e => setBoardPassword(e.target.value)}
                className="w-full bg-[#EBE4D8] border border-[#D9D0C1] rounded-lg px-4 py-3 text-[#423D38] focus:outline-none focus:ring-2 focus:ring-[#B58D3D] focus:border-[#B58D3D] transition-colors"
                placeholder={mode === 'create' ? "Optional, players will need this to join" : "Leave blank if none"}
              />
            </div>
          )}

          {error && (
            <div className="text-red-700 bg-red-100 border border-red-200 p-3 rounded-lg text-sm font-medium text-center">
              {error}
            </div>
          )}

          <button 
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#2C2824] text-[#E0D8D0] font-bold font-serif italic py-3 rounded-lg hover:bg-[#423D38] shadow-md transition-colors mt-4 disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : (mode === 'join' ? 'Join Board' : 'Create Board & Enter')}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#8C7B6E]">
          {mode === 'join' 
            ? 'Players can only join existing boards created by their DM.'
            : 'Only DMs can create boards. You will be the owner.'}
        </p>
      </div>
    </div>
  );
}
