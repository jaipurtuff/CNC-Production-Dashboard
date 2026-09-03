import React, { useEffect, useState } from 'react';
import { X, Clock, Layers, ShieldCheck, CheckCircle2, PauseCircle, PlayCircle } from 'lucide-react';
import { safeFetchJson } from '../lib/api';

interface JobTimelineModalProps {
  jobId: string | null;
  onClose: () => void;
}

export const JobTimelineModal: React.FC<JobTimelineModalProps> = ({ jobId, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    safeFetchJson<any>(`/api/jobs/${encodeURIComponent(jobId)}`)
      .then(({ data: d }) => {
        if (d) setData(d);
      })
      .catch(err => console.warn(err))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (!jobId) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
                JOB TIMELINE
              </span>
              <h3 className="text-base font-bold text-slate-100 font-mono">{jobId}</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Sheet-by-sheet execution history with resume detection points
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-slate-500">Loading timeline...</div>
          ) : !data ? (
            <div className="py-12 text-center text-xs font-mono text-slate-500">No data found</div>
          ) : (
            <>
              {/* Job Summary Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Dimensions</span>
                  <span className="text-slate-200 font-bold">{data.job.sheet_width_mm} × {data.job.sheet_height_mm} mm</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Material</span>
                  <span className="text-slate-200 font-bold">{data.job.material_code} ({data.job.sheet_thickness_mm}mm)</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Sheets Programmed</span>
                  <span className="text-slate-200 font-bold">{data.job.total_programmed_sheets}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Customer</span>
                  <span className="text-sky-300 font-bold">{data.job.customer_name || 'N/A'}</span>
                </div>
              </div>

              {/* Timeline Sequence */}
              <div>
                <h4 className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider mb-4">
                  Sheet-by-Sheet Production Milestones
                </h4>

                <div className="relative pl-6 border-l-2 border-slate-800 space-y-6">
                  {/* Job Created */}
                  <div className="relative">
                    <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-indigo-500 ring-4 ring-slate-900" />
                    <div className="text-xs font-mono">
                      <span className="text-slate-200 font-bold">Job Discovered &amp; Initialized</span>
                      <span className="text-slate-500 ml-2">
                        {new Date(data.job.first_detected_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Sheets cut */}
                  {data.timeline?.map((event: any, i: number) => {
                    const prevEvent = i > 0 ? data.timeline[i - 1] : null;
                    const isNewDay = prevEvent && prevEvent.productionDate !== event.productionDate;

                    return (
                      <React.Fragment key={event.eventId}>
                        {isNewDay && (
                          <div className="p-2.5 bg-indigo-950/30 border border-indigo-800/40 rounded-lg text-xs font-mono text-indigo-300 flex items-center space-x-2">
                            <PlayCircle className="w-4 h-4 text-emerald-400" />
                            <span>
                              <strong>Job Resumed on Next Day:</strong> Production Date transitioned to {event.productionDate}
                            </span>
                          </div>
                        )}

                        <div className="relative">
                          <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-slate-900" />
                          <div className="text-xs font-mono bg-slate-950/70 border border-slate-800 p-3 rounded-lg">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-emerald-400">
                                Sheet #{event.sheetIndex} Completed
                              </span>
                              <span className="text-slate-400">
                                {new Date(event.eventTimestamp).toLocaleTimeString()} ({event.productionDate})
                              </span>
                            </div>
                            <div className="mt-1 flex items-center space-x-3 text-[11px] text-slate-400">
                              <span>Pieces: {event.piecesCount}</span>
                              <span>•</span>
                              <span>Area: {event.areaSqm} m²</span>
                              {event.fbtLastWrite && (
                                <>
                                  <span>•</span>
                                  <span>FBT Write: {event.fbtLastWrite}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {/* Completion Status */}
                  {data.job.status === 'COMPLETED' ? (
                    <div className="relative">
                      <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-4 ring-slate-900" />
                      <div className="text-xs font-mono text-emerald-400 font-bold">
                        Job Completed ({data.job.total_programmed_sheets} of {data.job.total_programmed_sheets} sheets cut)
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 ring-4 ring-slate-900" />
                      <div className="text-xs font-mono text-amber-400">
                        Pending Execution ({(data.job.total_programmed_sheets || 0) - (data.timeline?.length || 0)} sheets remaining)
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
