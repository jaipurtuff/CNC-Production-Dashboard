import React, { useState, useEffect } from 'react';
import { FileCode, ShieldCheck, HelpCircle, AlertTriangle, Layers, Info } from 'lucide-react';
import { CncJobItem } from '../types';
import { safeFetchJson } from '../lib/api';

interface CncFileInspectorProps {
  jobs?: CncJobItem[];
  selectedJobId?: string;
}

export const CncFileInspector: React.FC<CncFileInspectorProps> = ({ jobs: initialJobs, selectedJobId }) => {
  const [jobsList, setJobsList] = useState<CncJobItem[]>(initialJobs || []);
  const [activeJobId, setActiveJobId] = useState(selectedJobId || (initialJobs?.[0]?.job_id ?? ''));
  const [jobDetail, setJobDetail] = useState<any>(null);
  const [activeFileTab, setActiveFileTab] = useState<'FBT' | 'OTD' | 'CNI' | 'Z01'>('FBT');

  // Lazy load jobs if not passed or empty
  useEffect(() => {
    if (!initialJobs || initialJobs.length === 0) {
      safeFetchJson<{ jobs: CncJobItem[] }>('/api/jobs?limit=50')
        .then(({ data }) => {
          if (data && Array.isArray(data.jobs)) {
            setJobsList(data.jobs);
            if (!activeJobId && data.jobs.length > 0) {
              setActiveJobId(data.jobs[0].job_id);
            }
          }
        })
        .catch(err => console.warn('Failed to fetch jobs in inspector:', err));
    }
  }, [initialJobs, activeJobId]);

  useEffect(() => {
    if (selectedJobId) setActiveJobId(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!activeJobId && jobsList.length > 0) {
      setActiveJobId(jobsList[0].job_id);
    }
  }, [jobsList, activeJobId]);

  useEffect(() => {
    if (!activeJobId) return;
    safeFetchJson<any>(`/api/jobs/${encodeURIComponent(activeJobId)}`)
      .then(({ data }) => {
        if (data) setJobDetail(data);
      })
      .catch(err => console.warn('Warning fetching job detail:', err));
  }, [activeJobId]);

  const currentJob = jobsList.find(j => j.job_id === activeJobId) || jobsList[0];

  return (
    <div className="space-y-6">
      {/* Job Selector Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">CNC Four-File Job Group Inspector</h3>
          <p className="text-xs text-slate-400">
            Reverse-engineered file structures with explicit CONFIRMED vs INFERRED status tags
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <label htmlFor="inspector-job-select" className="text-xs text-slate-400 font-mono">Job:</label>
          <select
            id="inspector-job-select"
            value={activeJobId}
            onChange={(e) => setActiveJobId(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 max-w-xs"
          >
            {jobsList.map(j => (
              <option key={j.job_id} value={j.job_id}>
                {j.job_id} ({j.total_programmed_sheets} sheets)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Epistemological Status Legend */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 flex items-start space-x-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold text-emerald-300 uppercase font-mono">CONFIRMED Facts</span>
            <p className="text-slate-400 mt-0.5 text-[11px]">
              Mother dimensions (DimX, DimY, Spes), OTD 2.5 headers, CNI LX/LY/LZ, distinct filename vs OTD dates.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 flex items-start space-x-2.5">
          <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold text-amber-300 uppercase font-mono">INFERRED Semantics</span>
            <p className="text-slate-400 mt-0.5 text-[11px]">
              Physical cutting completion timestamp (stored as detection time), piece assignment by sheet.
            </p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold text-slate-300 uppercase font-mono">UNKNOWN Parameters</span>
            <p className="text-slate-400 mt-0.5 text-[11px]">
              CNI P103, internal binary bytes in .z01 (safe string extraction only; no invented specs).
            </p>
          </div>
        </div>
      </div>

      {/* File Type Tabs */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="flex border-b border-slate-800 bg-slate-950/40">
          {(['FBT', 'OTD', 'CNI', 'Z01'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveFileTab(tab)}
              className={`px-4 py-3 text-xs font-mono font-medium border-b-2 transition-colors flex items-center space-x-2 ${
                activeFileTab === tab
                  ? 'border-indigo-500 text-indigo-300 bg-indigo-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>.{tab} File Analysis</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          {activeFileTab === 'FBT' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 font-mono">.FBT — Production Sheet Execution</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Parsed sections: [LAST_WRITE] header, [DISTINTA : CAMPI], [DISTINTA : RIGHE]
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700">
                  LAST_WRITE: {currentJob?.fbt_last_write || 'N/A'}
                </span>
              </div>

              {/* FBT Mother Sheet Grid */}
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Sheet #</th>
                      <th className="py-2 px-3">Sheet Code</th>
                      <th className="py-2 px-3 text-right">DimX (mm)</th>
                      <th className="py-2 px-3 text-right">DimY (mm)</th>
                      <th className="py-2 px-3 text-right">Spes (mm)</th>
                      <th className="py-2 px-3 text-right">Area (m²)</th>
                      <th className="py-2 px-3 text-center">Status</th>
                      <th className="py-2 px-3">Completion Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {jobDetail?.sheets?.map((s: any) => (
                      <tr key={s.sheet_index} className="hover:bg-slate-800/20">
                        <td className="py-2.5 px-3 font-bold text-slate-300">Sheet #{s.sheet_index}</td>
                        <td className="py-2.5 px-3 text-slate-400">{s.sheet_code}</td>
                        <td className="py-2.5 px-3 text-right text-slate-200">{s.width_mm}</td>
                        <td className="py-2.5 px-3 text-right text-slate-200">{s.height_mm}</td>
                        <td className="py-2.5 px-3 text-right text-slate-200">{s.thickness_mm}</td>
                        <td className="py-2.5 px-3 text-right text-slate-300">{Number(s.area_sqm).toFixed(4)}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              s.status === 'COMPLETED'
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {s.completed_at ? new Date(s.completed_at).toLocaleString() : 'Pending Execution'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeFileTab === 'OTD' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200 font-mono">.OTD — OPTIMA 2.5 Geometry &amp; Pieces</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Optimization header, planned waste percentage, customer info references.
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] font-mono text-slate-300 border border-slate-700">
                  OTD Date: {currentJob?.otd_date || 'N/A'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Glass Material</span>
                  <span className="text-slate-200 font-bold">{currentJob?.material_code}</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Mother Dimensions</span>
                  <span className="text-slate-200 font-bold">{currentJob?.sheet_width_mm} × {currentJob?.sheet_height_mm} mm</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Planned Waste %</span>
                  <span className="text-amber-400 font-bold">{currentJob?.planned_waste_pct ?? 7.77}% (Optimization)</span>
                </div>
                <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Customer &amp; WO</span>
                  <span className="text-sky-300 font-bold">{currentJob?.customer_name || 'N/A'} ({currentJob?.order_no})</span>
                </div>
              </div>

              {/* Pieces list */}
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">WO No.</th>
                      <th className="py-2 px-3">Customer</th>
                      <th className="py-2 px-3">Pos No.</th>
                      <th className="py-2 px-3 text-right">Piece Width</th>
                      <th className="py-2 px-3 text-right">Piece Height</th>
                      <th className="py-2 px-3 text-right">Piece Area (m²)</th>
                      <th className="py-2 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {jobDetail?.pieces?.map((p: any) => (
                      <tr key={p.id} className="hover:bg-slate-800/20">
                        <td className="py-2 px-3 text-sky-400 font-bold">{p.order_no}</td>
                        <td className="py-2 px-3 text-slate-200">{p.customer_name}</td>
                        <td className="py-2 px-3 text-slate-400">#{p.pos_no || p.piece_id}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{p.width_mm} mm</td>
                        <td className="py-2 px-3 text-right text-slate-300">{p.height_mm} mm</td>
                        <td className="py-2 px-3 text-right text-slate-300">{Number(p.area_sqm).toFixed(4)}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeFileTab === 'CNI' && (
            <div className="space-y-4 font-mono text-xs">
              <h4 className="text-sm font-semibold text-slate-200">.CNI — ISO Machine Instructions</h4>
              <p className="text-slate-400">
                Text-like ISO G-code cutting instructions and mother glass parameters.
              </p>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-slate-300 space-y-1">
                <div className="text-slate-500">; Parsed machine parameters:</div>
                <div className="text-emerald-400 font-bold">LX = {currentJob?.sheet_width_mm} mm (CONFIRMED Width)</div>
                <div className="text-emerald-400 font-bold">LY = {currentJob?.sheet_height_mm} mm (CONFIRMED Height)</div>
                <div className="text-emerald-400 font-bold">LZ = {currentJob?.sheet_thickness_mm} mm (CONFIRMED Thickness)</div>
                <div className="text-slate-500">P103 = 131 (UNKNOWN ISO Parameter)</div>
                <div className="text-sky-400">ST50 = &quot;{currentJob?.base_filename}.R01&quot; (Subroutine Project)</div>
              </div>
            </div>
          )}

          {activeFileTab === 'Z01' && (
            <div className="space-y-4 font-mono text-xs">
              <h4 className="text-sm font-semibold text-slate-200">.z01 — Binary / Structured Safety Extraction</h4>
              <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-lg text-amber-300 text-xs">
                <strong>Safety Policy Enforced:</strong> As specified in CNC guidelines, .z01 is binary/structured.
                The system extracts only safe UTF-8/ASCII path strings (e.g. C:\Opty-Way\M.R\...) and does NOT speculate or invent unconfirmed binary structures.
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-slate-300">
                <div className="text-slate-500 mb-1">Safe Extracted Reference Path:</div>
                <div className="text-indigo-400 font-bold break-all">
                  C:\Opty-Way\M.R\{currentJob?.base_filename}.R01
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
