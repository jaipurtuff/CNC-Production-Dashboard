import React, { useState, useEffect } from 'react';
import { X, Calendar, Layers, Box, Scale, Clock, ShieldCheck, Users, FileText, ChevronRight, BarChart3 } from 'lucide-react';
import { DailyProductionSummary, CncStatus } from '../types';
import { safeFetchJson } from '../lib/api';

interface ProductionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: CncStatus | null;
  dailySummary: DailyProductionSummary | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onInspectJob?: (jobId: string) => void;
}

export const ProductionDetailsModal: React.FC<ProductionDetailsModalProps> = ({
  isOpen,
  onClose,
  status,
  dailySummary,
  selectedDate,
  onSelectDate,
  onInspectJob,
}) => {
  const [activeTab, setActiveTab] = useState<'today' | 'orders' | 'timeline' | 'history'>('today');
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingHistory(true);
    safeFetchJson<{ history: any[] }>('/api/production/history?days=14')
      .then(({ data }) => {
        if (data && Array.isArray(data.history)) {
          setHistoryData(data.history);
        }
      })
      .catch(err => console.warn('Failed to fetch history:', err))
      .finally(() => setLoadingHistory(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const events = dailySummary?.events || [];
  const jobs = dailySummary?.jobBreakdown || [];
  const activeJob = status?.activeJob;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-100 font-mono">Detailed Production Analytics</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                  {selectedDate}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Granular CNC operational telemetry, material consumption, and verified cut timeline
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs Inside Modal */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6">
          <button
            onClick={() => setActiveTab('today')}
            className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'today'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Today's Jobs ({jobs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'orders'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Orders &amp; Customers</span>
          </button>

          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'timeline'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Event Timeline ({events.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'history'
                ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>14-Day Production Trends</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'today' && (
            <div className="space-y-6">
              {/* Summary KPIs Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Sheets Cut</span>
                  <span className="text-xl font-bold text-white">{dailySummary?.totalMotherSheetsCut ?? 0}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Pieces Produced</span>
                  <span className="text-xl font-bold text-emerald-400">{dailySummary?.totalPiecesCut ?? 0}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Area Cut</span>
                  <span className="text-xl font-bold text-sky-400">
                    {(dailySummary?.totalAreaSqm ?? 0).toFixed(3)} m²
                  </span>
                </div>
                <div className="p-3 bg-slate-950 rounded-xl border border-indigo-500/30">
                  <span className="text-indigo-300 block text-[10px] uppercase">Production Volume</span>
                  <span className="text-xl font-bold text-indigo-300">
                    {(dailySummary?.totalProductionSqmMm ?? 0).toFixed(3)}
                    <span className="text-[10px] text-indigo-400 ml-1 font-normal">m²-mm</span>
                  </span>
                </div>
              </div>

              {/* Jobs Breakdown Table */}
              <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                    Programs Cut on {selectedDate}
                  </h4>
                  <span className="text-xs text-slate-500 font-mono">{jobs.length} programs</span>
                </div>

                {jobs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs font-mono">
                    No production events recorded for this calendar date.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-4">Program / Job ID</th>
                          <th className="py-2.5 px-4">Customer(s)</th>
                          <th className="py-2.5 px-4">Material</th>
                          <th className="py-2.5 px-4 text-right">Cut Today</th>
                          <th className="py-2.5 px-4 text-right">Pieces</th>
                          <th className="py-2.5 px-4 text-right">Area (m²)</th>
                          <th className="py-2.5 px-4 text-right">m²-mm</th>
                          <th className="py-2.5 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {jobs.map((j) => (
                          <tr key={j.jobId} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-200">{j.jobId}</td>
                            <td className="py-3 px-4 text-slate-300 font-sans">
                              {j.customerNames && j.customerNames.length > 1 ? (
                                <div className="flex flex-wrap gap-1">
                                  {j.customerNames.map((c, i) => (
                                    <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-200">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span>{j.customerName || '—'}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-400">{j.materialCode}</td>
                            <td className="py-3 px-4 text-right font-bold text-emerald-400">
                              {j.sheetsCutToday} sh
                            </td>
                            <td className="py-3 px-4 text-right text-slate-200">{j.piecesCutToday}</td>
                            <td className="py-3 px-4 text-right text-sky-300">{j.areaSqmToday.toFixed(3)}</td>
                            <td className="py-3 px-4 text-right text-indigo-300 font-semibold">
                              {(j.productionSqmMmToday ?? 0).toFixed(3)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {onInspectJob && (
                                <button
                                  onClick={() => {
                                    onClose();
                                    onInspectJob(j.jobId);
                                  }}
                                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded text-[11px] transition-colors"
                                >
                                  Inspect
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <h4 className="text-xs font-bold text-slate-200 uppercase font-mono mb-2">
                  Customer Distribution for {selectedDate}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {jobs.flatMap(j => (j.customerNames || [j.customerName || 'Standard Order'])).map((c, idx) => (
                    <div key={idx} className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-200">{c}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/40">
                        Active In Cut
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs font-mono">
                  No sheet completion events detected on this date.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((ev, i) => (
                    <div
                      key={ev.eventId || i}
                      className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-bold border border-emerald-500/40">
                          #{ev.sheetIndex}
                        </span>
                        <div>
                          <span className="text-slate-200 font-semibold">{ev.jobId}</span>
                          <span className="text-slate-500 ml-2">Sheet {ev.sheetIndex}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-slate-400">
                        <span className="text-emerald-400 font-semibold">{ev.piecesCount} pcs</span>
                        <span>{ev.areaSqm.toFixed(3)} m²</span>
                        {ev.productionSqmMm !== undefined && (
                          <span className="text-indigo-300 font-semibold">
                            {ev.productionSqmMm.toFixed(3)} m²-mm
                          </span>
                        )}
                        <span className="text-slate-500 text-[11px]">
                          {new Date(ev.eventTimestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              {loadingHistory ? (
                <div className="p-12 text-center text-slate-500 text-xs font-mono">Loading history...</div>
              ) : (
                <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2.5 px-4">Date</th>
                          <th className="py-2.5 px-4 text-right">Mother Sheets</th>
                          <th className="py-2.5 px-4 text-right">Pieces</th>
                          <th className="py-2.5 px-4 text-right">Area (m²)</th>
                          <th className="py-2.5 px-4 text-right">Production (m²-mm)</th>
                          <th className="py-2.5 px-4 text-right">Active Programs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {historyData.map((h, i) => (
                          <tr key={i} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-3 px-4 font-semibold text-slate-200">{h.date}</td>
                            <td className="py-3 px-4 text-right text-emerald-400 font-bold">{h.motherSheetsCut}</td>
                            <td className="py-3 px-4 text-right text-slate-200">{h.piecesCut}</td>
                            <td className="py-3 px-4 text-right text-sky-300">{h.areaSqm.toFixed(3)}</td>
                            <td className="py-3 px-4 text-right text-indigo-300 font-bold">{h.productionSqmMm.toFixed(3)}</td>
                            <td className="py-3 px-4 text-right text-slate-400">{h.activeJobsCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
