import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseFbt } from './fbtParser.js';
import { parseOtd } from './otdParser.js';
import { parseCni } from './cniParser.js';
import { parseZ01 } from './z01Parser.js';
import { CorrelatedCncJob, ParsedFbt, ParsedOtd, ParsedCni, ParsedZ01 } from './types.js';

export interface DiscoveredFile {
  filename: string;
  filePath: string;
  ext: string;
  baseName: string;
  size: number;
  mtime: Date;
  sha256: string;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function groupCncFiles(fileList: DiscoveredFile[]): Map<string, DiscoveredFile[]> {
  const groups = new Map<string, DiscoveredFile[]>();

  for (const file of fileList) {
    const group = groups.get(file.baseName) || [];
    group.push(file);
    groups.set(file.baseName, group);
  }

  return groups;
}

export function parseFbtTimestamp(lastWriteStr?: string | null): Date | null {
  if (!lastWriteStr) return null;
  const trimmed = lastWriteStr.trim();
  const dmyMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hour = parseInt(dmyMatch[4] || '0', 10);
    const min = parseInt(dmyMatch[5] || '0', 10);
    const sec = parseInt(dmyMatch[6] || '0', 10);
    const d = new Date(Date.UTC(year, month, day, hour, min, sec));
    if (!isNaN(d.getTime())) return d;
  }
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function parseOtdTimestamp(otdDateStr?: string | null): Date | null {
  if (!otdDateStr) return null;
  const d = new Date(otdDateStr.trim());
  return isNaN(d.getTime()) ? null : d;
}

export function correlateJobFiles(baseName: string, files: DiscoveredFile[]): CorrelatedCncJob {
  let parsedFbt: ParsedFbt | undefined;
  let parsedOtd: ParsedOtd | undefined;
  let parsedCni: ParsedCni | undefined;
  let parsedZ01: ParsedZ01 | undefined;

  const jobFiles: CorrelatedCncJob['files'] = {};

  for (const file of files) {
    const extUpper = file.ext.toUpperCase();
    if (extUpper === '.FBT') {
      try {
        const content = fs.readFileSync(file.filePath, 'utf-8');
        parsedFbt = parseFbt(content);
        jobFiles.fbt = { path: file.filePath, mtime: file.mtime, size: file.size, parsed: parsedFbt };
      } catch (err) {
        console.error(`Error reading/parsing FBT for ${file.filename}:`, err);
      }
    } else if (extUpper === '.OTD') {
      try {
        const content = fs.readFileSync(file.filePath, 'utf-8');
        parsedOtd = parseOtd(content);
        jobFiles.otd = { path: file.filePath, mtime: file.mtime, size: file.size, parsed: parsedOtd };
      } catch (err) {
        console.error(`Error reading/parsing OTD for ${file.filename}:`, err);
      }
    } else if (extUpper === '.CNI') {
      try {
        const content = fs.readFileSync(file.filePath, 'utf-8');
        parsedCni = parseCni(content);
        jobFiles.cni = { path: file.filePath, mtime: file.mtime, size: file.size, parsed: parsedCni };
      } catch (err) {
        console.error(`Error reading/parsing CNI for ${file.filename}:`, err);
      }
    } else if (extUpper === '.Z01') {
      try {
        const buffer = fs.readFileSync(file.filePath);
        parsedZ01 = parseZ01(buffer);
        jobFiles.z01 = { path: file.filePath, mtime: file.mtime, size: file.size, parsed: parsedZ01 };
      } catch (err) {
        console.error(`Error reading/parsing z01 for ${file.filename}:`, err);
      }
    }
  }

  // Extract date from filename if matching DD-MM-YYYY
  const dateMatch = baseName.match(/^(\d{2}-\d{2}-\d{4})/);
  const filenameDate = dateMatch ? dateMatch[1] : undefined;

  // Cross-reference authoritative dimensions:
  // FBT DimX/DimY takes priority for individual sheets, or OTD width/height, or CNI LX/LY
  const firstFbtSheet = parsedFbt?.sheets[0];
  const sheetWidthMm = firstFbtSheet?.dimX || parsedOtd?.width || parsedCni?.lx || 0;
  const sheetHeightMm = firstFbtSheet?.dimY || parsedOtd?.height || parsedCni?.ly || 0;
  const sheetThicknessMm = firstFbtSheet?.thickness || parsedOtd?.glassThickness || parsedCni?.lz || 0;
  const materialCode = firstFbtSheet?.materialCode || parsedOtd?.glassId || parsedCni?.material || 'UNKNOWN';

  // Customer & Order extracted from OTD Info (Retain ALL distinct customers - do not pick only the first)
  const customerSet = new Set<string>();
  const orderSet = new Set<string>();
  if (parsedOtd && parsedOtd.pieces.length > 0) {
    for (const p of parsedOtd.pieces) {
      if (p.customer && p.customer.trim()) customerSet.add(p.customer.trim());
      if (p.orderNo && p.orderNo.trim()) orderSet.add(p.orderNo.trim());
    }
  }
  const customerNames = Array.from(customerSet);
  const orderNos = Array.from(orderSet);
  const customerName = customerNames.join(', ') || undefined;
  const orderNo = orderNos.join(', ') || undefined;

  const totalProgrammedSheets = parsedFbt?.totalPlannedSheets ?? parsedFbt?.totalSheets ?? 0;
  const completedSheetsCount = parsedFbt?.totalCutSheets ?? parsedFbt?.completedSheets ?? 0;
  const totalLayouts = parsedFbt?.totalLayouts ?? parsedFbt?.sheets.length ?? 0;
  const completedLayoutsCount = parsedFbt?.completedLayouts ?? 0;
  const totalPlannedSheets = totalProgrammedSheets;
  const totalCutSheets = completedSheetsCount;
  const totalPendingSheets = parsedFbt?.pendingSheets ?? Math.max(0, totalPlannedSheets - totalCutSheets);
  const isComplete = totalPlannedSheets > 0 && totalCutSheets >= totalPlannedSheets;

  // Authoritative Historical Production / Cutting Date (Issue 5)
  // Determine date from actual file metadata (FBT [LAST_WRITE], OTD Date, or FBT file mtime)
  // NEVER use today's scan/import date as historical production date
  const fbtParsedDate = parseFbtTimestamp(parsedFbt?.lastWrite);
  const fbtUpdateTimestamp = fbtParsedDate || jobFiles.fbt?.mtime;
  const otdParsedDate = parseOtdTimestamp(parsedOtd?.otdDate);
  const otdTimestamp = otdParsedDate || jobFiles.otd?.mtime;

  let effectiveCuttingDate = fbtParsedDate || fbtUpdateTimestamp || otdParsedDate || otdTimestamp || jobFiles.fbt?.mtime || jobFiles.otd?.mtime || jobFiles.cni?.mtime;
  if (!effectiveCuttingDate) {
    const mtimes = files.map(f => f.mtime.getTime());
    effectiveCuttingDate = mtimes.length > 0 ? new Date(Math.max(...mtimes)) : new Date();
  }
  const effectiveCuttingDateStr = effectiveCuttingDate.toISOString().split('T')[0];

  // Current Active Layout (Issue 4 & Confirmed FBT logic):
  // The logical next incomplete layout is the first layout where Cnt < Qta.
  // Do not use filename date to determine current layout.
  // Do not use newest database row to determine current layout.
  let currentLayoutIndex: number | null = null;
  if (parsedFbt && parsedFbt.sheets.length > 0) {
    const nextIncompleteLayout = parsedFbt.sheets.find(s => s.quantityCut < s.quantityProgrammed);
    if (nextIncompleteLayout) {
      currentLayoutIndex = nextIncompleteLayout.layoutIndex;
    } else if (isComplete && totalLayouts > 0) {
      // If entire job is cut, reference the last layout
      currentLayoutIndex = parsedFbt.sheets[parsedFbt.sheets.length - 1].layoutIndex;
    }
  }
  const currentSheetIndex = currentLayoutIndex;

  return {
    jobId: baseName,
    baseFilename: baseName,
    files: jobFiles,
    totalProgrammedSheets,
    completedSheetsCount,
    totalLayouts,
    completedLayoutsCount,
    currentLayoutIndex,
    totalPlannedSheets,
    totalCutSheets,
    totalPendingSheets,
    sheetWidthMm,
    sheetHeightMm,
    sheetThicknessMm,
    materialCode,
    customerName,
    customerNames,
    orderNo,
    orderNos,
    plannedWastePct: parsedOtd?.plannedWastePct,
    filenameDate,
    otdDate: parsedOtd?.otdDate,
    fbtLastWrite: parsedFbt?.lastWrite || undefined,
    effectiveCuttingDate,
    effectiveCuttingDateStr,
    fbtUpdateTimestamp,
    currentSheetIndex,
    isComplete,
    sheets: parsedFbt?.sheets || [],
    pieces: parsedOtd?.pieces || [],
  };
}
