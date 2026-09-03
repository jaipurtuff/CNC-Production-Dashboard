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

  // Customer & Order extracted from OTD Info
  let customerName: string | undefined;
  let orderNo: string | undefined;
  if (parsedOtd && parsedOtd.pieces.length > 0) {
    customerName = parsedOtd.pieces[0].customer;
    orderNo = parsedOtd.pieces[0].orderNo;
  }

  const totalProgrammedSheets = parsedFbt?.totalSheets || 0;
  const completedSheetsCount = parsedFbt?.completedSheets || 0;
  const isComplete = totalProgrammedSheets > 0 && completedSheetsCount >= totalProgrammedSheets;

  return {
    jobId: baseName,
    baseFilename: baseName,
    files: jobFiles,
    totalProgrammedSheets,
    completedSheetsCount,
    sheetWidthMm,
    sheetHeightMm,
    sheetThicknessMm,
    materialCode,
    customerName,
    orderNo,
    plannedWastePct: parsedOtd?.plannedWastePct,
    filenameDate,
    otdDate: parsedOtd?.otdDate,
    fbtLastWrite: parsedFbt?.lastWrite || undefined,
    isComplete,
    sheets: parsedFbt?.sheets || [],
    pieces: parsedOtd?.pieces || [],
  };
}
