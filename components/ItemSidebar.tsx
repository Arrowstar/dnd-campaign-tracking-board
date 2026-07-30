'use client';

import { useState } from 'react';
import { ItemType } from '@/lib/types';
import { 
  Users, User, Map, Scroll, BookOpen, Clock,
  Swords, Flag, Shield, Activity, Image as ImageIcon,
  ChevronLeft, ChevronRight, Plus, Compass, Sparkles, Coins
} from 'lucide-react';

interface ItemSidebarProps {
  onAddItem: (type: ItemType) => void;
}

interface ToolGroup {
  name: string;
  items: {
    type: ItemType;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    description: string;
    color: string;
  }[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    name: 'Characters & Factions',
    items: [
      { type: 'character', label: 'Character', icon: Users, description: 'Player character or hero', color: 'text-amber-400' },
      { type: 'npc', label: 'NPC', icon: User, description: 'Non-player character', color: 'text-blue-400' },
      { type: 'faction', label: 'Faction', icon: Shield, description: 'Guild, faction, or kingdom', color: 'text-purple-400' },
    ]
  },
  {
    name: 'World & Quests',
    items: [
      { type: 'location', label: 'Location', icon: Map, description: 'City, dungeon, or realm map', color: 'text-emerald-400' },
      { type: 'event', label: 'Event', icon: Flag, description: 'Key plot point or historical event', color: 'text-red-400' },
      { type: 'quest', label: 'Quest', icon: Swords, description: 'Bounty, objective, or mission', color: 'text-orange-400' },
      { type: 'session', label: 'Session Log', icon: Clock, description: 'Session recap & timeline', color: 'text-cyan-400' },
    ]
  },
  {
    name: 'Lore & Resources',
    items: [
      { type: 'note', label: 'Note', icon: Scroll, description: 'General note, parchment, secret', color: 'text-yellow-200' },
      { type: 'rule', label: 'Rule', icon: BookOpen, description: 'House rule or spell reference', color: 'text-teal-400' },
      { type: 'loot', label: 'Loot & Item', icon: Coins, description: 'Treasure, magic item, rewards', color: 'text-yellow-400' },
      { type: 'downtime', label: 'Downtime', icon: Sparkles, description: 'Crafting, downtime activities', color: 'text-pink-400' },
      { type: 'image', label: 'Image / Map', icon: ImageIcon, description: 'Battlemap or image reference', color: 'text-indigo-400' },
    ]
  }
];

export default function ItemSidebar({ onAddItem }: ItemSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div 
      className={`bg-[#2C2824] border-r border-[#B58D3D]/50 flex flex-col transition-all duration-300 z-30 shadow-2xl relative select-none h-full ${
        isCollapsed ? 'w-14' : 'w-60'
      }`}
    >
      {/* Sidebar Header */}
      <div className="h-12 border-b border-[#B58D3D]/30 flex items-center justify-between px-3 bg-[#231F1C] flex-shrink-0">
        {!isCollapsed && (
          <div className="flex items-center gap-2 text-[#E0D8D0] font-serif font-bold italic text-sm">
            <Compass size={18} className="text-[#B58D3D]" />
            <span className="tracking-wide">Add to Board</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-1.5 rounded hover:bg-[#37332F] text-[#A89F91] hover:text-[#E0D8D0] transition-colors cursor-pointer ${
            isCollapsed ? 'mx-auto' : ''
          }`}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Scrollable Tool List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-4 scrollbar-thin scrollbar-thumb-[#B58D3D]/40">
        {TOOL_GROUPS.map((group) => (
          <div key={group.name} className="space-y-1">
            {!isCollapsed && (
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#B58D3D] px-2 pt-1 pb-0.5 opacity-90 font-mono">
                {group.name}
              </h3>
            )}

            <div className="space-y-1">
              {group.items.map((tool) => {
                const IconComponent = tool.icon;
                return (
                  <button
                    key={tool.type}
                    type="button"
                    onClick={() => onAddItem(tool.type)}
                    className={`w-full flex items-center rounded-lg transition-all text-left cursor-pointer group border border-transparent ${
                      isCollapsed 
                        ? 'justify-center p-2.5 hover:bg-[#37332F] hover:border-[#B58D3D]/40' 
                        : 'gap-2.5 px-2.5 py-1.5 hover:bg-[#37332F] hover:border-[#B58D3D]/40'
                    }`}
                    title={isCollapsed ? `Add ${tool.label} — ${tool.description}` : undefined}
                  >
                    <div className={`p-1.5 rounded-md bg-[#1D1A18] group-hover:bg-[#2C2824] transition-colors flex-shrink-0 ${tool.color}`}>
                      <IconComponent size={16} />
                    </div>

                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#E0D8D0] group-hover:text-white truncate">
                            {tool.label}
                          </span>
                          <Plus size={12} className="text-[#B58D3D] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                        <p className="text-[10px] text-[#A89F91] truncate group-hover:text-[#C9C0B1] leading-tight">
                          {tool.description}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / Quick hint */}
      {!isCollapsed && (
        <div className="p-2.5 border-t border-[#B58D3D]/20 bg-[#231F1C]/80 text-[10px] text-[#A89F91] text-center italic font-serif flex-shrink-0">
          Click any element to add to board
        </div>
      )}
    </div>
  );
}
