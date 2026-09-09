import React, { useState, useEffect } from 'react';
import { FileCode, Search, Filter, Layers, Box, CheckCircle2, Clock, Eye, AlertCircle, ChevronRight, X, Maximize2 } from 'lucide-react';
import { safeFetchJson } from '../lib/api';
import { MotherSheetVisualizer } from './MotherSheetVisualizer';

interface CncFileCardItem {
  job_id: string;
  base_filename: string;
  order_no?: string | null;
  customer_name?: string | null;
  customerNames?: string[];
  material_code?: string | null;
  sheet_width_mm: number;
  sheet_height_mm: number;
  sheet_thickness_mm: number;
  total_layouts: number;
  total_planned_sheets: number;
  total_cut_sheets: number;
  total_pending_sheets: number;
  productionSqmMmCut: number;
  productionSqmMmPlanned: number;
  status: 'CUTTING' | 'PAUSED' | 'COMPLETED' | 'PENDING';
  created_at?: string;
  fbt_last_write?: string;
  has_fbt: boolean;
  has_otd: boolean;
  has_cni: boolean;
  has_z01: boolean;
}

interface CncFilesViewProps {
  initialJobId?: string;
}

export const CncFilesView: React.FC<CncFilesViewProps> = ({ initialJobId }) => {
  const [files, setFiles] = useState<CncFileCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'CUTTING' | 'PAUSED' | 'COMPLETED' | 'PENDING'>('ALL');
  const [selectedFileDetail, setSelectedFileDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'visualizer' | 'layouts' | 'pieces' | 'timeline'>('visualizer');

  // Load CNC File Cards
  const loadFiles = async () => {
    setLoading(true);
    try {
      const { data } = await safeFetchJson<{ files: CncFileCardItem[] }>('/api/cnc/files');
      if (data && Array.isArray(data.files)) {
        setFiles(data.files);
      }
    } catch (err) {
      console.warn('Failed to fetch cnc files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  // If initialJobId passed, open its detail
  useEffect(() => {
    if (initialJobId) {
      handleInspectFile(initialJobId);
    }
  }, [initialJobId]);

  const handleInspectFile = async (jobId: string) => {
    setLoadingDetail(true);
    try {
      const { data } = await safeFetchJson<any>(`/api/cnc/files/${encodeURIComponent(jobId)}`);
      if (data) {
        setSelectedFileDetail(data);
      }
    } catch (err) {
      console.warn('Error loading file detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Filter cards
  const filteredFiles = files.filter((f: any) => {
    const baseName = f.base_filename || f.baseFilename || '';
    const matCode = f.material_code || f.materialCode || '';
    const custName = f.customer_name || f.customerName || '';
    const ordNo = f.order_no || f.orderNo || '';
    const status = f.status || 'PENDING';

    const matchesSearch =
      baseName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      matCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ordNo.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-slate-200 font-mono">CNC Programs &amp; File Groups</h3>
          <p className="text-xs text-slate-400">
            Dedicated file cards for all monitored CNC programs with 4-file pairing and execution state
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search program, material, WO..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 w-56"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs font-mono">
            {(['ALL', 'CUTTING', 'PAUSED', 'COMPLETED', 'PENDING'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-1 rounded transition-colors ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 28. File Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-xs font-mono text-slate-500">Loading CNC program files...</div>
      ) : filteredFiles.length === 0 ? (
        <div className="py-16 text-center text-xs font-mono text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800">
          No CNC program files match your search criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFiles.map((fileRaw: any) => {
            const jobId = fileRaw.job_id || fileRaw.jobId;
            const baseName = fileRaw.base_filename || fileRaw.baseFilename;
            const material = fileRaw.material_code || fileRaw.materialCode || fileRaw.material || 'Standard';
            const thickness = Number(fileRaw.sheet_thickness_mm ?? fileRaw.thicknessMm ?? 5);
            const width = Number(fileRaw.sheet_width_mm ?? fileRaw.widthMm ?? 3660);
            const height = Number(fileRaw.sheet_height_mm ?? fileRaw.heightMm ?? 2440);
            const plannedSheets = Number(fileRaw.total_planned_sheets ?? fileRaw.totalPlannedSheets ?? fileRaw.total_programmed_sheets ?? 0);
            const cutSheets = Number(fileRaw.total_cut_sheets ?? fileRaw.totalCutSheets ?? 0);
            const sqmMmCut = Number(fileRaw.productionSqmMmCut ?? fileRaw.production_sqm_mm_cut ?? 0);
            const status = fileRaw.status || 'PENDING';
            const customerNames = fileRaw.customerNames || (fileRaw.customer_name ? [fileRaw.customer_name] : []);
            const orderNo = fileRaw.order_no || fileRaw.orderNo;
            const hasFbt = !!(fileRaw.has_fbt ?? fileRaw.hasFbt);
            const hasOtd = !!(fileRaw.has_otd ?? fileRaw.hasOtd);
            const hasCni = !!(fileRaw.has_cni ?? fileRaw.hasCni);
            const hasZ01 = !!(fileRaw.has_z01 ?? fileRaw.hasZ01);

            const progress = plannedSheets > 0
              ? Math.round((cutSheets / plannedSheets) * 100)
              : 0;

            return (
              <div
                key={jobId}
                className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl p-5 shadow-sm transition-all flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  {/* Top line: Status + Source File tags */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        status === 'CUTTING'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : status === 'COMPLETED'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          : status === 'PAUSED'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {status}
                    </span>

                    <div className="flex items-center space-x-1 text-[9px] font-mono font-semibold">
                      <span className={`px-1 rounded ${hasFbt ? 'bg-indigo-950 text-indigo-300 border border-indigo-800' : 'bg-slate-800 text-slate-500'}`}>FBT</span>
                      <span className={`px-1 rounded ${hasOtd ? 'bg-sky-950 text-sky-300 border border-sky-800' : 'bg-slate-800 text-slate-500'}`}>OTD</span>
                      <span className={`px-1 rounded ${hasCni ? 'bg-teal-950 text-teal-300 border border-teal-800' : 'bg-slate-800 text-slate-500'}`}>CNI</span>
                      <span className={`px-1 rounded ${hasZ01 ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-slate-800 text-slate-500'}`}>Z01</span>
                    </div>
                  </div>

                  {/* Program Title */}
                  <div>
                    <h4 className="text-sm font-bold font-mono text-white tracking-tight break-all">
                      {baseName}
                    </h4>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{material}</span>
                      <span>&bull;</span>
                      <span>{thickness} mm</span>
                      <span>&bull;</span>
                      <span className="font-mono">{width} × {height} mm</span>
                    </div>
                  </div>

                  {/* Customers & Orders */}
                  <div className="text-xs text-slate-300 space-y-0.5">
                    {customerNames.length > 1 ? (
                      <div className="flex items-center space-x-1">
                        <span className="text-slate-500">Customers:</span>
                        <div className="flex flex-wrap gap-1">
                          {customerNames.map((c: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] text-slate-200">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <span className="text-slate-500">Customer: </span>
                        <span className="text-slate-200 font-medium">{customerNames[0] || 'Standard Order'}</span>
                      </div>
                    )}
                    {orderNo && (
                      <div>
                        <span className="text-slate-500">WO: </span>
                        <span className="text-sky-300 font-mono">{orderNo}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress & Cut Volume */}
                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">
                      {cutSheets} / {plannedSheets} sheets ({progress}%)
                    </span>
                    <span className="text-indigo-300 font-semibold">
                      {sqmMmCut.toFixed(1)} m²-mm
                    </span>
                  </div>

                  <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        progress >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>

                  {/* 28. [VIEW DETAILS] button */}
                  <button
                    onClick={() => handleInspectFile(jobId)}
                    className="w-full py-2 bg-slate-800 hover:bg-indigo-600 hover:text-white text-indigo-300 text-xs font-mono font-medium rounded-lg transition-colors flex items-center justify-center space-x-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>VIEW DETAILS</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 29 & 30. Complete File Details Modal */}
      {selectedFileDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                    PROGRAM DETAILS
                  </span>
                  <h3 className="text-base font-bold text-white font-mono">{selectedFileDetail.job.base_filename}</h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedFileDetail.job.material_code} &bull; {selectedFileDetail.job.sheet_thickness_mm}mm &bull; {selectedFileDetail.job.sheet_width_mm} × {selectedFileDetail.job.sheet_height_mm} mm
                </p>
              </div>

              <button
                onClick={() => setSelectedFileDetail(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950/40 px-6">
              <button
                onClick={() => setActiveModalTab('visualizer')}
                className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                  activeModalTab === 'visualizer'
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Mother-Sheet Layout (Visual)</span>
              </button>

              <button
                onClick={() => setActiveModalTab('layouts')}
                className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                  activeModalTab === 'layouts'
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Layouts Breakdown ({selectedFileDetail.layouts?.length || 0})</span>
              </button>

              <button
                onClick={() => setActiveModalTab('pieces')}
                className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                  activeModalTab === 'pieces'
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>Pieces List ({selectedFileDetail.pieces?.length || 0})</span>
              </button>

              <button
                onClick={() => setActiveModalTab('timeline')}
                className={`py-3 px-4 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                  activeModalTab === 'timeline'
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Cutting Events ({selectedFileDetail.productionEvents?.length || 0})</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Tab 1: 30. Graphical Mother Sheet Layout */}
              {activeModalTab === 'visualizer' && (
                <MotherSheetVisualizer
                  sheetWidthMm={Number(selectedFileDetail.job.sheet_width_mm || 3660)}
                  sheetHeightMm={Number(selectedFileDetail.job.sheet_height_mm || 2440)}
                  thicknessMm={Number(selectedFileDetail.job.sheet_thickness_mm || 5)}
                  pieces={selectedFileDetail.pieces || []}
                  material={selectedFileDetail.job.material_code || 'Clear Glass'}
                  sheetNumber={1}
                />
              )}

              {/* Tab 2: Layouts Breakdown */}
              {activeModalTab === 'layouts' && (
                <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-4">Layout Index</th>
                        <th className="py-2.5 px-4">Layout Code</th>
                        <th className="py-2.5 px-4 text-right">Qta (Planned)</th>
                        <th className="py-2.5 px-4 text-right">Cnt (Cut)</th>
                        <th className="py-2.5 px-4 text-right">Pending</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(selectedFileDetail.layouts || []).map((l: any, i: number) => {
                        const pending = Math.max(0, l.qta - l.cnt);
                        return (
                          <tr key={i} className="hover:bg-slate-900/40">
                            <td className="py-3 px-4 font-bold text-slate-200">#{l.layoutIndex}</td>
                            <td className="py-3 px-4 text-slate-400 break-all">{l.layoutCode}</td>
                            <td className="py-3 px-4 text-right text-slate-200">{l.qta}</td>
                            <td className="py-3 px-4 text-right font-bold text-emerald-400">{l.cnt}</td>
                            <td className="py-3 px-4 text-right text-amber-400">{pending}</td>
                            <td className="py-3 px-4 text-center">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] uppercase ${
                                  l.isCompleted
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : l.cnt > 0
                                    ? 'bg-indigo-500/20 text-indigo-300'
                                    : 'bg-slate-800 text-slate-500'
                                }`}
                              >
                                {l.isCompleted ? 'Completed' : l.cnt > 0 ? 'In Progress' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: Pieces List */}
              {activeModalTab === 'pieces' && (
                <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-4">#</th>
                        <th className="py-2.5 px-4">Piece ID</th>
                        <th className="py-2.5 px-4">Work Order</th>
                        <th className="py-2.5 px-4">Customer</th>
                        <th className="py-2.5 px-4 text-right">Dimensions (mm)</th>
                        <th className="py-2.5 px-4 text-right">Area (m²)</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(selectedFileDetail.pieces || []).map((p: any, i: number) => (
                        <tr key={p.id || i} className="hover:bg-slate-900/40">
                          <td className="py-3 px-4 text-slate-500">{i + 1}</td>
                          <td className="py-3 px-4 font-bold text-slate-200">{p.piece_id || '—'}</td>
                          <td className="py-3 px-4 text-sky-300">{p.wo_no || p.order_no || '—'}</td>
                          <td className="py-3 px-4 text-slate-300 font-sans">{p.customer_name || '—'}</td>
                          <td className="py-3 px-4 text-right text-slate-200">{p.width_mm} × {p.height_mm}</td>
                          <td className="py-3 px-4 text-right text-slate-400">{Number(p.area_sqm || 0).toFixed(3)}</td>
                          <td className="py-3 px-4 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase bg-slate-800 text-slate-300">
                              {p.status || 'PROGRAMMED'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 4: Events Timeline */}
              {activeModalTab === 'timeline' && (
                <div className="space-y-3">
                  {(selectedFileDetail.productionEvents || []).length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs font-mono">
                      No production events logged yet.
                    </div>
                  ) : (
                    (selectedFileDetail.productionEvents || []).map((ev: any, i: number) => (
                      <div
                        key={ev.id || i}
                        className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                            #{ev.sheet_index}
                          </span>
                          <span className="text-slate-200">Sheet Cut #{ev.sheet_index}</span>
                        </div>
                        <div className="flex items-center space-x-4 text-slate-400">
                          <span className="text-emerald-400 font-semibold">{ev.pieces_count} pcs</span>
                          <span>{Number(ev.area_sqm || 0).toFixed(3)} m²</span>
                          <span className="text-slate-500">{new Date(ev.event_timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
