import React from 'react';
import { HardDrive, ShieldCheck, HelpCircle, ArrowRight, Layers, CheckCircle2 } from 'lucide-react';
import { CncStatus } from '../types';

interface ActiveJobBannerProps {
  status: CncStatus | null;
  onSelectJob?: (jobId: string) => void;
}

export const ActiveJobBanner: React.FC<ActiveJobBannerProps> = ({ status, onSelectJob }) => {
  const activeJob = status?.activeJob;
  const currentSheet = status?.currentSheetIndex ?? null;

  if (!activeJob) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-300">CNC Cutting Table Idle</h3>
            <p className="text-xs text-slate-500">Awaiting new file transition or sheet completion signal on CNC share.</p>
          </div>
        </div>
        <div className="text-xs font-mono text-slate-500">Scanning continuous feed...</div>
      </div>
    );
  }

  // FBT Layout-based metrics
  const totalLayouts = activeJob.total_layouts || activeJob.layouts?.length || 0;
  const plannedSheets = activeJob.total_planned_sheets ?? activeJob.total_programmed_sheets ?? 0;
  const sheetsCut = activeJob.total_cut_sheets ?? activeJob.completedSheets ?? 0;
  const sheetsPending = activeJob.total_pending_sheets ?? Math.max(0, plannedSheets - sheetsCut);
  const progressPct = plannedSheets > 0 ? Math.round((sheetsCut / plannedSheets) * 100) : 0;

  const currentLayout = activeJob.current_layout;
  const currentLayoutIndex = activeJob.current_layout_index ?? currentLayout?.layoutIndex ?? currentSheet;

  return (
    <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900 border border-indigo-500/30 rounded-xl p-6 shadow-md relative overflow-hidden">
      {/* Background subtle accent */}
      <div className="absolute top-0 right-0 w-96 h-full bg-indigo-500/5 blur-3xl pointer-events-none" />

      <div className="relative z-10">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>ACTIVE CNC JOB</span>
              </span>
              <span className="text-xs font-mono text-slate-400">
                Job ID: <strong className="text-slate-200">{activeJob.job_id}</strong>
              </span>
              {activeJob.order_no && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 text-[11px] font-mono border border-slate-700">
                  WO: {activeJob.order_no}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-bold text-white tracking-tight font-mono">
                {totalLayouts > 0 ? (
                  <>
                    Current Layout: <span className="text-indigo-400">#{currentLayoutIndex ?? 1}</span>{' '}
                    <span className="text-slate-500 text-base font-normal">of {totalLayouts}</span>
                  </>
                ) : currentSheet !== null ? (
                  <>
                    Raw Sheet #{currentSheet}{' '}
                    <span className="text-slate-500 text-base font-normal">of {plannedSheets}</span>
                  </>
                ) : (
                  <>
                    Current Program:{' '}
                    <span className="text-slate-200 font-normal">{activeJob.base_filename}</span>
                  </>
                )}
              </h2>

              {currentLayout && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                  Layout #{currentLayout.layoutIndex}: {currentLayout.cnt} / {currentLayout.qta} sheets cut
                </span>
              )}

              {activeJob.customerNames && activeJob.customerNames.length > 1 ? (
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-medium text-slate-400">Customers:</span>
                  <div className="flex flex-wrap gap-1">
                    {activeJob.customerNames.map((c: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-semibold">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              ) : activeJob.customer_name ? (
                <span className="text-sm font-medium text-slate-300">
                  Customer: <span className="text-indigo-300">{activeJob.customer_name}</span>
                </span>
              ) : null}
            </div>
          </div>

          {/* Quick Specifications adhering directly to confirmed metrics */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center min-w-[90px]">
              <span className="block text-[10px] uppercase text-slate-500 font-mono">Planned Sheets</span>
              <span className="text-sm font-bold font-mono text-slate-200">
                {plannedSheets}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center min-w-[90px]">
              <span className="block text-[10px] uppercase text-slate-500 font-mono">Sheets Cut</span>
              <span className="text-sm font-bold font-mono text-emerald-400">
                {sheetsCut}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center min-w-[90px]">
              <span className="block text-[10px] uppercase text-slate-500 font-mono">Sheets Pending</span>
              <span className="text-sm font-bold font-mono text-amber-400">
                {sheetsPending}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-center min-w-[80px]">
              <span className="block text-[10px] uppercase text-slate-500 font-mono">Progress</span>
              <span className="text-sm font-bold font-mono text-indigo-400">
                {progressPct}%
              </span>
            </div>
          </div>
        </div>

        {/* Progress Bar & Layout Execution Sequence */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {totalLayouts > 0 ? 'FBT Layout Execution Sequence' : 'Mother Sheet Execution Sequence'}
              </span>
            </span>
            <span>
              {sheetsCut} Cut • {sheetsPending} Pending ({progressPct}% Complete)
            </span>
          </div>

          {/* Visual Step Pills for Layouts */}
          {activeJob.layouts && activeJob.layouts.length > 0 ? (
            <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-22 gap-1.5">
              {activeJob.layouts.map((layout) => {
                const isCompleted = layout.isCompleted;
                const isCurrent = layout.layoutIndex === currentLayoutIndex && !isCompleted;
                const isPartiallyCut = layout.cnt > 0 && !isCompleted;

                return (
                  <div
                    key={layout.layoutIndex}
                    title={`Layout #${layout.layoutIndex} (${layout.layoutCode}): ${layout.cnt}/${layout.qta} cut`}
                    className={`h-7 rounded flex flex-col items-center justify-center px-1 text-[10px] font-mono font-medium transition-all ${
                      isCompleted
                        ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                        : isCurrent
                        ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-400 animate-pulse ring-1 ring-indigo-400'
                        : isPartiallyCut
                        ? 'bg-amber-600/30 text-amber-200 border border-amber-500/50'
                        : 'bg-slate-950/50 text-slate-500 border border-slate-800'
                    }`}
                  >
                    <span>L{layout.layoutIndex}</span>
                    <span className="text-[8px] opacity-70 leading-none">{layout.cnt}/{layout.qta}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-10 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-20 gap-1.5">
              {Array.from({ length: Math.min(plannedSheets, 60) }).map((_, idx) => {
                const sheetIdx = idx + 1;
                const isCut = sheetIdx <= sheetsCut;
                const isCurrent = sheetIdx === currentSheet && !isCut;

                return (
                  <div
                    key={sheetIdx}
                    title={`Sheet #${sheetIdx}: ${isCut ? 'COMPLETED' : 'PENDING'}`}
                    className={`h-7 rounded flex items-center justify-center text-[10px] font-mono font-medium transition-all ${
                      isCut
                        ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                        : isCurrent
                        ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-400 animate-pulse ring-1 ring-indigo-400'
                        : 'bg-slate-950/50 text-slate-500 border border-slate-800'
                    }`}
                  >
                    {sheetIdx}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Evidence & Confidence Metadata */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 gap-3">
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>FBT: CONFIRMED (Cod, DimX, DimY, Spes, Qta, Cnt)</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>Raw Sheet: {activeJob.sheet_width_mm} × {activeJob.sheet_height_mm} mm</span>
            <span className="text-slate-600">•</span>
            <span>Mat: {activeJob.sheet_thickness_mm}mm ({activeJob.material_code})</span>
            <span className="text-slate-600">•</span>
            <span>FBT Write: {activeJob.fbt_last_write || 'N/A'}</span>
          </div>

          {onSelectJob && (
            <button
              onClick={() => onSelectJob(activeJob.job_id)}
              className="text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 text-xs"
            >
              <span>View Job Timeline</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
