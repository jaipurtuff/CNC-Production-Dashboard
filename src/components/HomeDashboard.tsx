import React, { useState } from 'react';
import { HardDrive, Activity, Layers, Box, Scale, CheckCircle2, PlayCircle, Clock, ChevronRight, BarChart3, AlertCircle, FileText } from 'lucide-react';
import { CncStatus, DailyProductionSummary } from '../types';
import { ProductionDetailsModal } from './ProductionDetailsModal';

interface HomeDashboardProps {
  status: CncStatus | null;
  dailySummary: DailyProductionSummary | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  lastUpdated: Date;
  onInspectJob?: (jobId: string) => void;
  onNavigateToFiles?: () => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  status,
  dailySummary,
  selectedDate,
  onSelectDate,
  lastUpdated,
  onInspectJob,
  onNavigateToFiles,
}) => {
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const activeJob = status?.activeJob;
  const isOnline = status?.isOnline ?? false;
  const collectorState = status?.collectorState || (isOnline ? (activeJob ? 'LIVE' : 'STALE') : 'OFFLINE');

  // Plan & sheet counts
  const totalLayouts = activeJob?.total_layouts || activeJob?.layouts?.length || 0;
  const plannedSheets = activeJob?.total_planned_sheets ?? activeJob?.total_programmed_sheets ?? 0;
  const cutSheets = activeJob?.total_cut_sheets ?? activeJob?.completedSheets ?? 0;
  const pendingSheets = activeJob?.total_pending_sheets ?? Math.max(0, plannedSheets - cutSheets);
  const progressPct = plannedSheets > 0 ? ((cutSheets / plannedSheets) * 100) : 0;

  const currentLayout = activeJob?.current_layout;
  const currentLayoutIndex = activeJob?.current_layout_index ?? currentLayout?.layoutIndex ?? (cutSheets + 1);
  const currentSheetIndex = status?.currentSheetIndex ?? currentLayoutIndex;

  // Determine status label
  let operationalStatus: 'CUTTING' | 'READY' | 'PAUSED' | 'COMPLETED' = 'READY';
  if (plannedSheets > 0 && cutSheets >= plannedSheets) {
    operationalStatus = 'COMPLETED';
  } else if (isOnline && activeJob) {
    operationalStatus = 'CUTTING';
  } else if (cutSheets > 0 && cutSheets < plannedSheets) {
    operationalStatus = 'PAUSED';
  } else {
    operationalStatus = 'READY';
  }

  // Today's KPIs
  const todaySheets = dailySummary?.totalMotherSheetsCut ?? 0;
  const todayPieces = dailySummary?.totalPiecesCut ?? 0;
  const todaySqmMm = dailySummary?.totalProductionSqmMm ?? 0;

  // Visual sequence builder
  // If we have layouts: each layout has an index, qta and cnt.
  // Or sheet-by-sheet sequence:
  const displayItems = activeJob?.layouts && activeJob.layouts.length > 0
    ? activeJob.layouts.map(l => ({
        index: l.layoutIndex,
        code: l.layoutCode,
        isCompleted: l.cnt >= l.qta,
        isCurrent: l.layoutIndex === currentLayoutIndex && operationalStatus === 'CUTTING',
        cnt: l.cnt,
        qta: l.qta,
      }))
    : Array.from({ length: plannedSheets || 10 }, (_, i) => {
        const idx = i + 1;
        return {
          index: idx,
          code: `Sheet #${idx}`,
          isCompleted: idx <= cutSheets,
          isCurrent: idx === currentLayoutIndex && operationalStatus === 'CUTTING',
          cnt: idx <= cutSheets ? 1 : 0,
          qta: 1,
        };
      });

  return (
    <div className="space-y-6">
      {/* 32. Top Operational Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-xl px-5 py-3.5 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs uppercase font-mono font-bold tracking-wider text-slate-400">
              CNC Production
            </span>
            <span className="text-slate-600">&bull;</span>
            <div className="flex items-center space-x-1.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  collectorState === 'LIVE'
                    ? 'bg-emerald-400 animate-pulse ring-4 ring-emerald-400/20'
                    : collectorState === 'STALE'
                    ? 'bg-amber-400 ring-4 ring-amber-400/20'
                    : 'bg-rose-500'
                }`}
              />
              <span
                className={`text-xs font-mono font-bold uppercase tracking-wider ${
                  collectorState === 'LIVE'
                    ? 'text-emerald-400'
                    : collectorState === 'STALE'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {collectorState}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 text-xs font-mono text-slate-400">
          <div className="flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Last update: <strong className="text-slate-200">{lastUpdated.toLocaleTimeString()}</strong></span>
          </div>
          {onNavigateToFiles && (
            <button
              onClick={onNavigateToFiles}
              className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors flex items-center space-x-1"
            >
              <span>CNC Files</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 32 & 33. Main HERO Section: CURRENT PLAN */}
      {activeJob ? (
        <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/20 border border-indigo-500/40 rounded-2xl p-6 sm:p-7 shadow-xl relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-6">
            {/* Header: CURRENT PLAN Tag & Status */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] font-mono font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 uppercase">
                    CURRENT PLAN
                  </span>
                  <span className={`text-[11px] font-mono font-bold tracking-wider px-2.5 py-0.5 rounded-full uppercase flex items-center space-x-1.5 ${
                    operationalStatus === 'CUTTING'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : operationalStatus === 'COMPLETED'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    {operationalStatus === 'CUTTING' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
                    <span>STATUS: {operationalStatus}</span>
                  </span>
                </div>
                <h2 className="mt-2 text-xl sm:text-2xl font-bold font-mono text-white tracking-tight break-all">
                  {activeJob.base_filename}
                </h2>
              </div>

              {/* Specifications Pills */}
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Material</span>
                  <span className="text-slate-200 font-bold">{activeJob.material_code || 'Standard'}</span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Thickness</span>
                  <span className="text-slate-200 font-bold">{Number(activeJob.sheet_thickness_mm || 5).toFixed(1)} mm</span>
                </div>
                <div className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Mother Sheet</span>
                  <span className="text-slate-200 font-bold">{activeJob.sheet_width_mm} × {activeJob.sheet_height_mm} mm</span>
                </div>
              </div>
            </div>

            {/* Key Progress Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              {/* Progress Count */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-500 block text-xs font-mono uppercase">Progress</span>
                <div className="mt-1 flex items-baseline space-x-2 font-mono">
                  <span className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                    {cutSheets} / {plannedSheets}
                  </span>
                  <span className="text-xs text-slate-400 uppercase">Sheets</span>
                </div>
                <div className="mt-2 text-xs font-mono font-semibold text-indigo-400">
                  {progressPct.toFixed(1)}% Completed
                </div>
              </div>

              {/* Current Sheet / Layout */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-indigo-500/30 relative">
                <span className="text-indigo-300 block text-xs font-mono uppercase">Current Sheet</span>
                <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold text-indigo-200">
                  #{currentSheetIndex}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-400">
                  Layout: <strong className="text-slate-200">#{currentLayoutIndex}</strong> of {totalLayouts || plannedSheets}
                </div>
              </div>

              {/* Production m²-mm Cut */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-500 block text-xs font-mono uppercase">Cut Volume</span>
                <div className="mt-1 font-mono text-2xl sm:text-3xl font-bold text-white">
                  {(activeJob.productionSqmMmCut ?? 0).toFixed(2)}
                </div>
                <div className="mt-2 text-xs font-mono text-slate-400">
                  m²-mm of {(activeJob.productionSqmMmPlanned ?? 0).toFixed(2)} planned
                </div>
              </div>

              {/* Customers & Work Orders */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
                <div>
                  <span className="text-slate-500 block text-xs font-mono uppercase">Customer(s)</span>
                  <div className="mt-1 text-xs font-bold text-slate-200 truncate">
                    {activeJob.customerNames && activeJob.customerNames.length > 0
                      ? activeJob.customerNames.join(', ')
                      : activeJob.customer_name || 'Standard Production'}
                  </div>
                </div>
                {onInspectJob && (
                  <button
                    onClick={() => onInspectJob(activeJob.job_id)}
                    className="mt-2 text-xs font-mono text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                  >
                    <span>View program details</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span>Execution Timeline: {cutSheets} cut, {pendingSheets} pending</span>
                <span>{progressPct.toFixed(1)}%</span>
              </div>
              <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, progressPct))}%` }}
                />
              </div>
            </div>

            {/* 32 & 33. Visual Sheet Sequence */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase text-slate-300 tracking-wider">
                  Visual Sheet Sequence
                </span>
                <div className="flex items-center space-x-3 text-[11px] font-mono text-slate-400">
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500 flex items-center justify-center text-[8px]">✓</span>
                    <span>Completed</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 border border-indigo-400" />
                    <span>Active Now</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="w-2.5 h-2.5 rounded-full border border-slate-600 bg-slate-900" />
                    <span>Pending</span>
                  </span>
                </div>
              </div>

              {/* Scrollable Compact Sequence Container */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 overflow-x-auto scrollbar-thin">
                <div className="flex items-center space-x-2 min-w-max">
                  {displayItems.map((item) => {
                    if (item.isCurrent) {
                      return (
                        <div
                          key={item.index}
                          className="flex items-center px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-mono text-xs font-bold shadow-lg shadow-indigo-500/30 border border-indigo-300 ring-2 ring-indigo-400/50 scale-105 transition-transform"
                        >
                          <span className="w-2 h-2 rounded-full bg-white animate-ping mr-1.5" />
                          <span>#{String(item.index).padStart(2, '0')} ●</span>
                          {item.qta > 1 && (
                            <span className="ml-1 text-[10px] text-indigo-200">({item.cnt}/{item.qta})</span>
                          )}
                        </div>
                      );
                    }

                    if (item.isCompleted) {
                      return (
                        <div
                          key={item.index}
                          className="flex items-center px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 font-mono text-xs font-medium"
                        >
                          <span>#{String(item.index).padStart(2, '0')} ✓</span>
                          {item.qta > 1 && (
                            <span className="ml-1 text-[10px] text-emerald-400 font-normal">({item.cnt}/{item.qta})</span>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.index}
                        className="flex items-center px-2.5 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-500 font-mono text-xs font-normal"
                      >
                        <span>#{String(item.index).padStart(2, '0')} ○</span>
                        {item.qta > 1 && (
                          <span className="ml-1 text-[10px] text-slate-600 font-normal">({item.cnt}/{item.qta})</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Standby state when no CNC job actively executing */
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 mx-auto">
            <HardDrive className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold font-mono text-slate-200">CNC Cutting Table Standby</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            The background collector is watching the CNC share directory. Start a program on the CNC cutting table to track live sheet-by-sheet progress.
          </p>
        </div>
      )}

      {/* 34. HOME DASHBOARD — MINIMAL KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sheets */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Today's Sheets</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{todaySheets}</span>
            <span className="text-xs text-slate-400 font-mono">mother sheets</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 font-mono">Cut on {selectedDate}</p>
        </div>

        {/* Today's Pieces */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Today's Pieces</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Box className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">{todayPieces}</span>
            <span className="text-xs text-slate-400 font-mono">pieces produced</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 font-mono">Total nested pieces</p>
        </div>

        {/* Today's Production m²-mm */}
        <div className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-300 tracking-wide uppercase">Production Volume</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-indigo-200 tracking-tight">
              {todaySqmMm.toFixed(2)}
            </span>
            <span className="text-xs text-indigo-400 font-mono font-semibold">m²-mm</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 font-mono">Canonical Area × Thickness</p>
        </div>

        {/* Current Plan Progress & CNC Status */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 tracking-wide uppercase">Current Plan</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
            }`}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-3xl font-bold font-mono text-slate-50 tracking-tight">
              {progressPct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({cutSheets}/{plannedSheets})
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500 font-mono truncate">
            {activeJob ? activeJob.base_filename : 'No active job'}
          </p>
        </div>
      </div>

      {/* 35. MORE DETAILS BUTTON */}
      <div className="flex items-center justify-center pt-2">
        <button
          onClick={() => setShowDetailsModal(true)}
          className="px-6 py-3 bg-slate-900 hover:bg-slate-850 hover:border-indigo-500/60 border border-slate-800 rounded-xl text-xs font-mono font-semibold text-slate-200 hover:text-white transition-all shadow-md flex items-center space-x-2.5 group"
        >
          <BarChart3 className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
          <span>OPEN DETAILED PRODUCTION ANALYTICS</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* Detailed Production Analytics Modal */}
      <ProductionDetailsModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        status={status}
        dailySummary={dailySummary}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onInspectJob={onInspectJob}
      />
    </div>
  );
};
