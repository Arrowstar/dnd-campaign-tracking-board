'use client';

import { useRef, useState } from 'react';
import { Bell, MessageSquare } from 'lucide-react';
import type { NotificationRow } from '@/app/api/boards/[boardId]/notifications/route';

interface NotificationBellProps {
  notifications: NotificationRow[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (ids: number[]) => void;
  /** Deep-link: open the drawer on the notification's card (Feature 08). */
  onNotificationClick: (n: NotificationRow) => void;
}

/** Compact "Xm ago"-style timestamp for notification rows. */
function formatAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Toolbar bell showing @mention notifications for the current user (Feature 08).
 * The dropdown is a lightweight popover: click-away closes, clicking a row
 * deep-links to the card (via Board), and the whole list can be marked read.
 */
export default function NotificationBell({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
  onNotificationClick,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRowClick = (n: NotificationRow) => {
    if (n.itemDeleted) return;
    onMarkRead([n.id]);
    setOpen(false);
    onNotificationClick(n);
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } }}
      onMouseLeave={() => {
        closeTimer.current = setTimeout(() => setOpen(false), 250);
      }}
    >
      <button
        type="button"
        onClick={() => { setOpen(o => !o); }}
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
        title={unreadCount > 0 ? `${unreadCount} unread mention${unreadCount === 1 ? '' : 's'}` : 'Notifications'}
      >
        <Bell size={14} className={unreadCount > 0 ? 'text-[#B58D3D]' : 'text-[#A89F91]'} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-80 max-h-[70vh] flex flex-col bg-[#2C2824] border border-[#B58D3D]/50 rounded-xl shadow-2xl text-[#E0D8D0] font-sans text-xs animate-in fade-in zoom-in-95 duration-150 origin-top-right">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#B58D3D]/30">
              <span className="text-sm font-bold font-serif italic text-[#B58D3D]">Mentions</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => { onMarkAllRead(); }}
                  className="text-[10px] font-bold uppercase tracking-wider text-[#A89F91] hover:text-[#E0D8D0] transition-colors cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-[#A89F91] italic">
                  No mentions yet — try @mentioning someone in a comment.
                </div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleRowClick(n)}
                    disabled={n.itemDeleted}
                    className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      n.itemDeleted
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-[#37332F] cursor-pointer'
                    } ${!n.read ? 'bg-[#B58D3D]/10' : ''}`}
                  >
                    <MessageSquare size={13} className="text-[#B58D3D] mt-0.5 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">
                        <span className="font-bold text-[#E0D8D0]">{n.commenterName || 'Someone'}</span>{' '}
                        <span className="text-[#C9C0B1]">mentioned you on</span>{' '}
                        <span className="font-bold text-[#B58D3D]">&ldquo;{n.itemTitle || 'Untitled'}&rdquo;</span>
                      </span>
                      <span className="block text-[10px] text-[#A89F91] mt-0.5">
                        {n.itemDeleted ? 'Card or comment removed' : formatAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[#B58D3D] mt-1.5 flex-shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
