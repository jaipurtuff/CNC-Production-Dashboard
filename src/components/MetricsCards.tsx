import React from 'react';
import { Layers, Box, Maximize2, Cpu } from 'lucide-react';
import { DailyProductionSummary } from '../types';

interface MetricsCardsProps {
  summary: DailyProductionSummary | null;
  selectedDate: string;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({ summary, selectedDate }) => {
  const sheets = summary?.totalMotherSheetsCut ?? 0;
  const pieces = summary?.totalPiecesCut ?? 0;
  const area = summary?.totalAreaSqm ?? 0;
  const jobs = summary?.activeJobsCount ?? 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Mother Sheets Cut */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Mother Sheets Cut</span>
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{sheets}</span>
          <span className="text-xs text-slate-400 font-mono">sheets</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Immutable completion events for {selectedDate}
        </p>
      </div>

      {/* Pieces Cut */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Pieces Cut</span>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Box className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{pieces}</span>
          <span className="text-xs text-slate-400 font-mono">pieces</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Source order piece count on completed sheets
        </p>
      </div>

      {/* Total Area Cut */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Total Area Cut</span>
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Maximize2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{area.toFixed(4)}</span>
          <span className="text-xs text-slate-400 font-mono">m²</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Σ (DimX/1000 × DimY/1000) for completed sheets
        </p>
      </div>

      {/* Active CNC Jobs */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Jobs In Production</span>
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Cpu className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{jobs}</span>
          <span className="text-xs text-slate-400 font-mono">programs</span>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Distinct CNC programs with completions on {selectedDate}
        </p>
      </div>
    </div>
  );
};
