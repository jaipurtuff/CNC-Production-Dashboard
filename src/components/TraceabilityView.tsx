import React, { useState, useEffect } from 'react';
import { Layers, Search, ArrowRight, ShieldCheck, Clock, FileCheck } from 'lucide-react';
import { TraceabilityRecord } from '../types';
import { safeFetchJson } from '../lib/api';

interface TraceabilityViewProps {
  initialWo?: string;
}

export const TraceabilityView: React.FC<TraceabilityViewProps> = ({ initialWo }) => {
  const [woFilter, setWoFilter] = useState(initialWo || '');
  const [records, setRecords] = useState<TraceabilityRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTraceability = async (wo: string) => {
    setLoading(true);
    try {
      const url = wo ? `/api/traceability?wo=${encodeURIComponent(wo)}` : '/api/traceability';
      const { data } = await safeFetchJson<{ records: TraceabilityRecord[] }>(url);
      setRecords(data?.records || []);
    } catch (err) {
      console.warn('Error fetching traceability:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTraceability(woFilter);
  }, [woFilter]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Piece-Level Traceability Audit</h3>
          <p className="text-xs text-slate-400">
            Chain of custody: Customer → WO No. → Piece → Mother Sheet → CNC Job → Production Event
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Filter by Work Order (e.g. 26-27-T01995)..."
            value={woFilter}
            onChange={(e) => setWoFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Traceability Records List */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono">Loading traceability records...</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-mono">
            No piece traceability records found for filter &quot;{woFilter}&quot;.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {records.map((r, idx) => (
              <div key={idx} className="p-4 hover:bg-slate-800/30 transition-colors">
                {/* Visual Traceability Chain */}
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  {/* Customer */}
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300 font-sans font-medium">
                    {r.customer_name || 'Customer'}
                  </span>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                  {/* WO No. */}
                  <span className="px-2.5 py-1 rounded bg-sky-950/40 border border-sky-800/60 text-sky-300 font-bold">
                    WO: {r.order_no}
                  </span>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                  {/* Piece */}
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Pos #{r.pos_no || r.piece_id || idx + 1} ({r.piece_width || '—'} × {r.piece_height || '—'} mm)
                  </span>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                  {/* Mother Sheet */}
                  <span className="px-2.5 py-1 rounded bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 font-bold">
                    Mother Sheet #{r.sheet_index}
                  </span>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                  {/* CNC Job */}
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Job: {r.job_id}
                  </span>

                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                  {/* Status / Event */}
                  <span
                    className={`px-2.5 py-1 rounded font-bold ${
                      r.piece_status === 'CUT'
                        ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-300'
                        : 'bg-amber-950/40 border border-amber-800/60 text-amber-300'
                    }`}
                  >
                    {r.piece_status === 'CUT' ? 'PRODUCED' : 'PENDING'}
                  </span>
                </div>

                {/* Event Timestamp and Metadata */}
                {r.event_timestamp && (
                  <div className="mt-2.5 flex items-center space-x-3 text-[11px] font-mono text-slate-400">
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>Cut Event: {new Date(r.event_timestamp).toLocaleString()}</span>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span>Production Date: {r.production_date}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-emerald-400 font-medium">Confidence: {r.confidence}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
