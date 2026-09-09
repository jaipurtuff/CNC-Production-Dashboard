import React, { useState } from 'react';
import { Maximize2, Layers, Box, Info } from 'lucide-react';

interface PieceItem {
  id: number;
  piece_id?: string | null;
  sheet_index: number;
  order_no?: string | null;
  wo_no?: string | null;
  customer_name?: string | null;
  width_mm: number;
  height_mm: number;
  area_sqm?: number;
  status?: string;
}

interface MotherSheetVisualizerProps {
  sheetWidthMm: number;
  sheetHeightMm: number;
  thicknessMm: number;
  pieces?: PieceItem[];
  material?: string;
  sheetNumber?: number;
  plannedWastePct?: number | null;
}

export const MotherSheetVisualizer: React.FC<MotherSheetVisualizerProps> = ({
  sheetWidthMm = 3660,
  sheetHeightMm = 2440,
  thicknessMm = 5,
  pieces = [],
  material = 'Clear Glass',
  sheetNumber = 1,
  plannedWastePct = null,
}) => {
  const [hoveredPiece, setHoveredPiece] = useState<PieceItem | null>(null);

  const motherAreaSqm = (sheetWidthMm / 1000) * (sheetHeightMm / 1000);
  const piecesAreaSqm = pieces.reduce((sum, p) => {
    const a = p.area_sqm || (Number(p.width_mm || 0) / 1000) * (Number(p.height_mm || 0) / 1000);
    return sum + a;
  }, 0);
  const calculatedWastePct = motherAreaSqm > 0
    ? Math.max(0, Math.round(((motherAreaSqm - piecesAreaSqm) / motherAreaSqm) * 100))
    : 0;

  // ViewBox coordinates
  const svgWidth = 700;
  const svgHeight = Math.round((sheetHeightMm / sheetWidthMm) * svgWidth) || 466;

  // Lay out pieces deterministically if no x/y
  let curX = 20;
  let curY = 20;
  let rowMaxH = 0;
  const scale = (svgWidth - 40) / sheetWidthMm;

  const renderedPieces = pieces.map((p, idx) => {
    const w = Math.max(20, Math.round(Number(p.width_mm || 400) * scale));
    const h = Math.max(20, Math.round(Number(p.height_mm || 300) * scale));

    if (curX + w > svgWidth - 20) {
      curX = 20;
      curY += rowMaxH + 8;
      rowMaxH = 0;
    }

    const x = curX;
    const y = Math.min(curY, svgHeight - h - 10);
    curX += w + 8;
    if (h > rowMaxH) rowMaxH = h;

    const isCut = p.status === 'COMPLETED' || p.status === 'CUT';

    return {
      ...p,
      x,
      y,
      w,
      h,
      isCut,
      index: idx + 1,
    };
  });

  return (
    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Maximize2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider">
              Mother-Sheet Layout Geometry {sheetNumber ? `(Sheet #${sheetNumber})` : ''}
            </h4>
            <p className="text-[11px] text-slate-400 font-mono">
              {sheetWidthMm} × {sheetHeightMm} mm &bull; {thicknessMm}mm &bull; {motherAreaSqm.toFixed(3)} m² &bull; {material}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs font-mono">
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
            Pieces: <strong className="text-indigo-400">{pieces.length}</strong>
          </div>
          <div className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
            Yield Waste:{' '}
            <strong className="text-amber-400">
              {plannedWastePct !== null ? `${plannedWastePct.toFixed(1)}%` : `${calculatedWastePct}%`}
            </strong>
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative border border-slate-800 rounded-lg bg-slate-900/60 p-3 overflow-hidden">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto max-h-[380px] select-none"
          style={{ aspectRatio: `${sheetWidthMm} / ${sheetHeightMm}` }}
        >
          {/* Mother Sheet Boundary */}
          <rect
            x={2}
            y={2}
            width={svgWidth - 4}
            height={svgHeight - 4}
            rx={6}
            fill="#0f172a"
            stroke="#334155"
            strokeWidth={2}
          />

          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect x={4} y={4} width={svgWidth - 8} height={svgHeight - 8} fill="url(#grid)" />

          {/* Rendered Pieces */}
          {renderedPieces.map((p) => {
            const isHovered = hoveredPiece?.id === p.id;
            return (
              <g
                key={p.id || p.index}
                onMouseEnter={() => setHoveredPiece(p)}
                onMouseLeave={() => setHoveredPiece(null)}
                className="cursor-pointer transition-transform"
              >
                <rect
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  rx={3}
                  fill={p.isCut ? 'rgba(16, 185, 129, 0.22)' : 'rgba(99, 102, 241, 0.25)'}
                  stroke={
                    isHovered
                      ? '#38bdf8'
                      : p.isCut
                      ? '#10b981'
                      : '#6366f1'
                  }
                  strokeWidth={isHovered ? 2 : 1.2}
                  strokeDasharray={p.isCut ? 'none' : '2 2'}
                />

                {/* Piece Dimensions or Label */}
                {p.w > 45 && p.h > 24 && (
                  <text
                    x={p.x + p.w / 2}
                    y={p.y + p.h / 2 - (p.h > 40 ? 4 : 0)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={p.isCut ? '#6ee7b7' : '#c7d2fe'}
                    fontSize={Math.min(10, Math.max(7, Math.floor(p.w / 7)))}
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {p.piece_id || `#${p.index}`}
                  </text>
                )}

                {p.w > 65 && p.h > 42 && (
                  <text
                    x={p.x + p.w / 2}
                    y={p.y + p.h / 2 + 8}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#94a3b8"
                    fontSize={8}
                    fontFamily="monospace"
                  >
                    {p.width_mm}×{p.height_mm}
                  </text>
                )}
              </g>
            );
          })}

          {/* Dimension ruler labels */}
          <text x={svgWidth / 2} y={svgHeight - 8} textAnchor="middle" fill="#64748b" fontSize={9} fontFamily="monospace">
            {sheetWidthMm} mm
          </text>
          <text
            x={12}
            y={svgHeight / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${svgHeight / 2})`}
            fill="#64748b"
            fontSize={9}
            fontFamily="monospace"
          >
            {sheetHeightMm} mm
          </text>
        </svg>

        {/* Hovered piece popup card */}
        {hoveredPiece && (
          <div className="absolute bottom-4 right-4 bg-slate-950/95 border border-indigo-500/50 rounded-lg p-3 text-xs font-mono shadow-xl max-w-xs z-20 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 text-indigo-300 font-bold border-b border-slate-800 pb-1.5 mb-1.5">
              <span>{hoveredPiece.piece_id || `Piece #${hoveredPiece.id}`}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded uppercase ${
                hoveredPiece.status === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-indigo-500/20 text-indigo-300'
              }`}>
                {hoveredPiece.status || 'PROGRAMMED'}
              </span>
            </div>
            <div className="space-y-0.5 text-slate-300 text-[11px]">
              <div>Size: <strong className="text-white">{hoveredPiece.width_mm} × {hoveredPiece.height_mm} mm</strong></div>
              {hoveredPiece.customer_name && <div>Customer: <span className="text-sky-300">{hoveredPiece.customer_name}</span></div>}
              {hoveredPiece.wo_no && <div>Work Order: <span className="text-amber-300">{hoveredPiece.wo_no}</span></div>}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 pt-1">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500" />
            <span>Cut / Completed</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3 h-3 rounded bg-indigo-500/30 border border-indigo-500 border-dashed" />
            <span>Programmed / Pending</span>
          </div>
        </div>
        <div className="text-[11px] text-slate-500">
          Source: Verified OTD Dimensions &bull; Proportional Scale
        </div>
      </div>
    </div>
  );
};
