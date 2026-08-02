'use client';

import { UploadCloud, AlertTriangle } from 'lucide-react';

/**
 * Small themed progress pill shown where a file is being uploaded.
 * Passed `percent` (0–100) drives the bar; pass `error` to render a
 * failure state instead.
 */
export default function UploadProgress({
  percent,
  label = 'Uploading',
  error,
}: {
  percent: number;
  label?: string;
  error?: string | null;
}) {
  if (error) {
    return (
      <div className="pointer-events-none flex items-center gap-2 bg-red-600/95 border border-red-400 text-white px-3 py-1.5 rounded-lg shadow-2xl text-xs font-bold">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="truncate max-w-[240px]">{error}</span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="pointer-events-none flex items-center gap-2.5 bg-[#2C2824]/95 backdrop-blur-sm border border-[#B58D3D] text-[#E0D8D0] px-3 py-2 rounded-xl shadow-2xl text-xs font-bold">
      <UploadCloud size={16} className="text-[#B58D3D] animate-pulse flex-shrink-0" />
      <div className="flex flex-col gap-1 min-w-[130px] max-w-[220px]">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          <span className="flex-shrink-0 font-mono text-[#B58D3D]">{clamped}%</span>
        </span>
        <div className="h-1.5 rounded-full bg-[#423D38] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#B58D3D] transition-[width] duration-150"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
    </div>
  );
}