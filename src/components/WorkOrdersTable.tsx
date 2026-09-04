import React, { useState, useEffect, useCallback } from 'react';
import { Database, Search, CheckCircle2, Clock, ArrowUpRight, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { WorkOrderItem } from '../types';
import { safeFetchJson } from '../lib/api';

interface WorkOrdersTableProps {
  orders?: WorkOrderItem[];
  onSelectWo: (woNo: string) => void;
}

export const WorkOrdersTable: React.FC<WorkOrdersTableProps> = ({ orders: initialOrders, onSelectWo }) => {
  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [orders, setOrders] = useState<WorkOrderItem[]>(initialOrders || []);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Debounce search filter
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedFilter(filter);
      setPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [filter]);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = `/api/orders?page=${page}&limit=${limit}&search=${encodeURIComponent(debouncedFilter)}`;
      const { data } = await safeFetchJson<{
        orders: WorkOrderItem[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      }>(url);

      if (data && Array.isArray(data.orders)) {
        setOrders(data.orders);
        setTotalPages(data.totalPages || 1);
        setTotalRecords(data.total || 0);
      }
    } catch (err) {
      console.warn('Failed to fetch orders:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, debouncedFilter]);

  // Lazy-load data when opened or when page/search changes
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

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
        fetchOrders();
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
            Read-only Service Account synchronization joined with permanent PostgreSQL cutting records ({totalRecords} orders)
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
                <th className="py-2.5 px-4">Customer Name(s)</th>
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
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500 font-mono">
                    Loading work orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500 font-mono">
                    No matching work orders found.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const woVal = o.work_order_no || o.wo_no || '';
                  const customerList = o.customers && o.customers.length > 0
                    ? o.customers
                    : (o.customer_name ? o.customer_name.split(',').map(s => s.trim()) : []);

                  return (
                    <tr key={o.id || woVal} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4 text-slate-400 font-bold tracking-wider">
                        {o.ref_code || o.order_no || '-'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-sky-400">
                        {woVal}
                      </td>
                      <td className="py-3 px-4 text-slate-200 font-sans">
                        {customerList.length > 1 ? (
                          <div className="flex flex-wrap gap-1">
                            {customerList.map((c, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-200">
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span>{customerList[0] || o.customer_name || '-'}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {o.material || '-'}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300 font-bold">
                        {o.total_required_pcs ?? o.ordered_pcs ?? 0}
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
                          onClick={() => onSelectWo(woVal)}
                          className="px-2.5 py-1 bg-indigo-950/60 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-800/60 rounded text-[11px] flex items-center space-x-1 mx-auto transition-colors"
                        >
                          <span>Trace</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-3 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
          <div>
            Showing Page <span className="font-bold text-slate-200">{page}</span> of{' '}
            <span className="font-bold text-slate-200">{totalPages}</span> ({totalRecords} total orders)
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
