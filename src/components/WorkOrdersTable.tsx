import React, { useState } from 'react';
import { Database, Search, CheckCircle2, Clock, ArrowUpRight, RefreshCw } from 'lucide-react';
import { WorkOrderItem } from '../types';
import { safeFetchJson } from '../lib/api';

interface WorkOrdersTableProps {
  orders: WorkOrderItem[];
  onSelectWo: (woNo: string) => void;
}

export const WorkOrdersTable: React.FC<WorkOrdersTableProps> = ({ orders, onSelectWo }) => {
  const [filter, setFilter] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const { data, error } = await safeFetchJson<{ result?: { totalRows: number }; error?: string }>(
        '/api/sync/trigger',
        { method: 'POST' }
      );
      if (data && data.result) {
        setSyncFeedback(`Sync completed: ${data.result?.totalRows || 0} rows processed`);
      } else {
        setSyncFeedback(`Sync message: ${error || data?.error || 'Check credentials'}`);
      }
    } catch (err: any) {
      setSyncFeedback(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const filteredOrders = orders.filter((o) => {
    const q = filter.toLowerCase();
    return (
      o.wo_no.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.ref_code.toLowerCase().includes(q) ||
      o.material.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <h3 className="text-sm font-semibold text-slate-200">Google Sheets API Order Master Linkage</h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800/80 text-emerald-400">
              5-min auto sync
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Read-only Service Account synchronization joined with permanent PostgreSQL cutting records
          </p>
          {syncFeedback && (
            <p className="text-[11px] font-mono text-indigo-400 mt-1">{syncFeedback}</p>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="px-3 py-1.5 bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 rounded-lg text-xs font-mono flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Google Sheet'}</span>
          </button>

          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search WO, Customer, Ref..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 font-mono border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Ref Code</th>
                <th className="py-2.5 px-4">WO No.</th>
                <th className="py-2.5 px-4">Customer Name</th>
                <th className="py-2.5 px-4">Material</th>
                <th className="py-2.5 px-4 text-right">Ordered Pcs</th>
                <th className="py-2.5 px-4 text-right">Produced Pcs</th>
                <th className="py-2.5 px-4 text-right">Pending</th>
                <th className="py-2.5 px-4 text-center">Progress</th>
                <th className="py-2.5 px-4">Linked CNC Job</th>
                <th className="py-2.5 px-4 text-center">Traceability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredOrders.map((o) => (
                <tr key={o.wo_no} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 text-slate-400 font-bold tracking-wider">
                    {o.ref_code}
                  </td>
                  <td className="py-3 px-4 font-semibold text-sky-400">
                    {o.wo_no}
                  </td>
                  <td className="py-3 px-4 text-slate-200 font-sans">
                    {o.customer_name}
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    {o.material}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-300 font-bold">
                    {o.ordered_pcs}
                  </td>
                  <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                    {o.producedPieces}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-400">
                    {o.pendingPieces}
                  </td>
                  <td className="py-3 px-4 w-36">
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            o.completionPct >= 100
                              ? 'bg-emerald-500'
                              : o.completionPct > 0
                              ? 'bg-indigo-500'
                              : 'bg-slate-700'
                          }`}
                          style={{ width: `${Math.min(100, o.completionPct)}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-bold text-slate-300 w-9 text-right">
                        {o.completionPct}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-[11px]">
                    {o.linkedJobId || 'Awaiting Job Run'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => onSelectWo(o.wo_no)}
                      className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 rounded text-[11px] flex items-center space-x-1 mx-auto transition-colors"
                    >
                      <span>Trace</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
