import React from 'react';
import { Calendar, Clock, Layers, ShieldCheck, HelpCircle, FileText, CheckCircle2 } from 'lucide-react';
import { DailyProductionSummary } from '../types';

interface DailyTimelineProps {
  summary: DailyProductionSummary | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onInspectJob: (jobId: string) => void;
}

export const DailyTimeline: React.FC<DailyTimelineProps> = ({
  summary,
  selectedDate,
  onSelectDate,
  onInspectJob,
}) => {
  const events = summary?.events || [];
  const jobs = summary?.jobBreakdown || [];

  return (
    <div className="space-y-6">
      {/* Date Header & Quick Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Daily Production History &amp; Events</h3>
            <p className="text-xs text-slate-400">
              Immutable event log aggregated by production date ({selectedDate})
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <label htmlFor="prod-date-picker" className="text-xs text-slate-400 font-mono">Date:</label>
          <input
            id="prod-date-picker"
            type="date"
            value={selectedDate}
            onChange={(e) => onSelectDate(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => onSelectDate(new Date().toISOString().split('T')[0])}
            className="px-2.5 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
          >
            Today
          </button>
        </div>
      </div>

      {/* Daily Job Breakdown */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
            Jobs Produced on {selectedDate}
          </h4>
          <span className="text-xs font-mono text-slate-500">{jobs.length} Active Jobs</span>
        </div>

        {jobs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono">
            No production events recorded for this calendar date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-mono border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Job ID / Program</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">WO No.</th>
                  <th className="py-2.5 px-4">Material</th>
                  <th className="py-2.5 px-4 text-right">Sheets Cut Today</th>
                  <th className="py-2.5 px-4 text-right">Pieces Cut</th>
                  <th className="py-2.5 px-4 text-right">Area Cut (m²)</th>
                  <th className="py-2.5 px-4 text-right">Lifetime Progress</th>
                  <th className="py-2.5 px-4 text-center">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {jobs.map((j) => (
                  <tr key={j.jobId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {j.jobId}
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-sans">
                      {j.customerNames && j.customerNames.length > 1 ? (
                        <div className="flex flex-wrap gap-1">
                          {j.customerNames.map((c, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-200">
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span>{j.customerName || '—'}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sky-400">
                      {j.orderNo || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {j.materialCode}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400">
                      +{j.sheetsCutToday}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-300">
                      {j.piecesCutToday}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-300">
                      {j.areaSqmToday.toFixed(4)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className="text-slate-300 font-bold">{j.lifetimeCompletedSheets}</span>
                      <span className="text-slate-500"> / {j.totalProgrammedSheets}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => onInspectJob(j.jobId)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] transition-colors"
                      >
                        Timeline
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sheet-by-Sheet Immutable Events Stream */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
              Immutable Sheet Completion Events
            </h4>
          </div>
          <span className="text-xs font-mono text-slate-500">{events.length} Events on {selectedDate}</span>
        </div>

        {events.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono">
            No sheet events detected on this date.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-mono border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Event ID</th>
                  <th className="py-2.5 px-4">Job ID</th>
                  <th className="py-2.5 px-4">Sheet Index</th>
                  <th className="py-2.5 px-4">Pieces</th>
                  <th className="py-2.5 px-4">Area (m²)</th>
                  <th className="py-2.5 px-4">Event Timestamp</th>
                  <th className="py-2.5 px-4">FBT LAST_WRITE</th>
                  <th className="py-2.5 px-4">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {events.map((e) => (
                  <tr key={e.eventId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 text-slate-500">#{e.eventId}</td>
                    <td className="py-2.5 px-4 text-slate-200 font-medium">{e.jobId}</td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 font-bold">
                        Sheet #{e.sheetIndex}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">{e.piecesCount} pcs</td>
                    <td className="py-2.5 px-4 text-slate-300">{e.areaSqm.toFixed(4)} m²</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {new Date(e.eventTimestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">{e.fbtLastWrite || '—'}</td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          e.confidence === 'CONFIRMED'
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                            : 'bg-amber-950/60 text-amber-400 border border-amber-800'
                        }`}
                      >
                        {e.confidence}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
