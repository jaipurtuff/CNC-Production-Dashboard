export interface FbtFieldDefinition {
  fieldIndex: number;
  name: string;
  type: string;
  length: string;
  decimals: string;
}

export interface FbtSheetRecord {
  rawLine: string;
  sheetCode: string; // Cod = Layout Serial Number (CONFIRMED)
  sheetIndex: number; // Layout serial number / index (1..N)
  layoutIndex: number; // 1-based layout index
  dimX: number; // Width mm (DimX) (CONFIRMED)
  dimY: number; // Height mm (DimY) (CONFIRMED)
  thickness: number; // Spes mm (CONFIRMED)
  quantityProgrammed: number; // Qta = Total raw sheets required for this layout (CONFIRMED)
  quantityCut: number; // Cnt = Actual raw sheets already cut by CNC for this layout (CONFIRMED)
  progressState: number; // Column 6 (Unconfirmed)
  completionFlag: number; // Column 7 (Unconfirmed)
  materialCode: string; // Column 8 (e.g. F5, F6)
  isCompleted: boolean; // Evaluated strictly as quantityCut >= quantityProgrammed (Cnt >= Qta)
}

export interface ParsedFbt {
  lastWrite: string | null; // e.g. "04-09-2026 16:56:03" (CONFIRMED header)
  fields: FbtFieldDefinition[];
  sheets: FbtSheetRecord[]; // Layout records
  totalLayouts: number; // Count of distinct layouts (e.g. 44)
  completedLayouts: number; // Count of layouts with Cnt >= Qta
  totalPlannedSheets: number; // SUM(Qta) across all layouts (e.g. 66)
  totalCutSheets: number; // SUM(Cnt) across all layouts (e.g. 26)
  pendingSheets: number; // SUM(Math.max(0, Qta - Cnt)) across all layouts (e.g. 40)
  totalSheets: number; // Alias to totalPlannedSheets (SUM(Qta))
  completedSheets: number; // Alias to totalCutSheets (SUM(Cnt))
  unresolvedFields: Record<string, string>;
}

export interface OtdPieceInfo {
  id?: string;
  orderNo?: string; // e.g. "26-27-T01995" (CONFIRMED)
  posNo?: string; // e.g. "61" (CONFIRMED)
  customer?: string; // e.g. "Lingel Windo" (CONFIRMED)
  sheetWidth?: number; // mm (CONFIRMED)
  sheetHeight?: number; // mm (CONFIRMED)
  sheetCode?: string;
  rackNo?: string;
  areaSqm: number;
}

export interface ParsedOtd {
  cutVersion?: string; // e.g. "2.5" (CONFIRMED)
  dimensionUnit?: string; // "mm" (CONFIRMED)
  otdDate?: string; // e.g. "Tue Sep 01 16:27:07 2026" (CONFIRMED: header date != filename date)
  creator?: string; // "OPTIMA S.r.l." (CONFIRMED)
  optimizationPrj?: string; // e.g. "18-08-2026-A-06MM CLEAR------.R01" (CONFIRMED)
  glassId?: string; // e.g. "F6" (CONFIRMED)
  glassThickness?: number; // e.g. 6.00 (CONFIRMED)
  programmedPieces?: number; // e.g. 1 or 12 (CONFIRMED)
  width?: number; // e.g. 3660.00 (CONFIRMED)
  height?: number; // e.g. 2770.00 (CONFIRMED)
  trimLeft?: number;
  trimBottom?: number;
  pieces: OtdPieceInfo[];
  plannedWastePct?: number; // Calculated optimization waste percentage (CONFIRMED: planned waste only)
}

export interface ParsedCni {
  project?: string;
  material?: string;
  creator?: string;
  version?: string;
  lx?: number; // Width mm (CONFIRMED)
  ly?: number; // Height mm (CONFIRMED)
  lz?: number; // Thickness mm (CONFIRMED)
  p103?: number; // Stored as UNKNOWN parameter
  subroutinePrj?: string; // ST50="18-08-2026-A-06MM CLEAR------.R01" (CONFIRMED)
  rawIsoCommands: string[];
}

export interface ParsedZ01 {
  referencedProjectPath?: string; // e.g. "C:\Opty-Way\M.R\18-08-2026-A-06MM CLEAR------.R01"
  safeAsciiStrings: string[];
  binarySizeBytes: number;
  note: string; // Clarifies that binary structure is safe-read only
}

export interface CorrelatedCncJob {
  jobId: string;
  baseFilename: string;
  files: {
    fbt?: { path: string; mtime: Date; size: number; parsed: ParsedFbt };
    otd?: { path: string; mtime: Date; size: number; parsed: ParsedOtd };
    cni?: { path: string; mtime: Date; size: number; parsed: ParsedCni };
    z01?: { path: string; mtime: Date; size: number; parsed: ParsedZ01 };
  };
  // Authoritative cross-file correlated properties:
  totalProgrammedSheets: number; // SUM(Qta) = Planned raw sheets
  completedSheetsCount: number; // SUM(Cnt) = Actual raw sheets cut
  totalLayouts?: number; // Total distinct layouts (e.g. 44)
  completedLayoutsCount?: number; // Layouts where Cnt >= Qta
  currentLayoutIndex?: number | null; // First layout where Cnt < Qta
  totalPlannedSheets?: number; // Alias to totalProgrammedSheets
  totalCutSheets?: number; // Alias to completedSheetsCount
  totalPendingSheets?: number; // SUM(Math.max(0, Qta - Cnt))
  sheetWidthMm: number;
  sheetHeightMm: number;
  sheetThicknessMm: number;
  materialCode: string;
  customerName?: string;
  customerNames?: string[];
  orderNo?: string;
  orderNos?: string[];
  plannedWastePct?: number;
  filenameDate?: string;
  otdDate?: string;
  fbtLastWrite?: string;
  effectiveCuttingDate?: Date;
  effectiveCuttingDateStr?: string;
  fbtUpdateTimestamp?: Date;
  currentSheetIndex?: number | null;
  isComplete: boolean;
  sheets: FbtSheetRecord[];
  pieces: OtdPieceInfo[];
}
