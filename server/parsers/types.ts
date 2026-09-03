export interface FbtFieldDefinition {
  fieldIndex: number;
  name: string;
  type: string;
  length: string;
  decimals: string;
}

export interface FbtSheetRecord {
  rawLine: string;
  sheetCode: string;
  sheetIndex: number;
  dimX: number; // Width mm (CONFIRMED)
  dimY: number; // Height mm (CONFIRMED)
  thickness: number; // Spes mm (CONFIRMED)
  quantityProgrammed: number; // Qta (CONFIRMED)
  quantityCut: number; // Cnt (CONFIRMED)
  progressState: number; // Column 6 (INFERRED: progress counter or sheet index)
  completionFlag: number; // Column 7 (INFERRED: 1 = completed, 0 = pending)
  materialCode: string; // Column 8 (CONFIRMED: e.g. F6)
  isCompleted: boolean; // Evaluated: (quantityCut >= quantityProgrammed) || completionFlag === 1
}

export interface ParsedFbt {
  lastWrite: string | null; // e.g. "01-09-2026 16:27:07" (CONFIRMED header)
  fields: FbtFieldDefinition[];
  sheets: FbtSheetRecord[];
  totalSheets: number;
  completedSheets: number;
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
  totalProgrammedSheets: number;
  completedSheetsCount: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  sheetThicknessMm: number;
  materialCode: string;
  customerName?: string;
  orderNo?: string;
  plannedWastePct?: number;
  filenameDate?: string;
  otdDate?: string;
  fbtLastWrite?: string;
  isComplete: boolean;
  sheets: FbtSheetRecord[];
  pieces: OtdPieceInfo[];
}
