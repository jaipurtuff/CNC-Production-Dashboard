import { OtdPieceInfo, ParsedOtd } from './types.js';

export function parseOtd(content: string): ParsedOtd {
  const lines = content.split(/\r?\n/);

  const result: ParsedOtd = {
    pieces: [],
  };

  let currentSection = '';
  let currentPiece: Partial<OtdPieceInfo> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    if (rawLine.startsWith('[') && rawLine.endsWith(']')) {
      if (currentPiece && (currentPiece.orderNo || currentPiece.sheetWidth)) {
        const w = currentPiece.sheetWidth || 0;
        const h = currentPiece.sheetHeight || 0;
        const areaSqm = (w / 1000) * (h / 1000);
        result.pieces.push({
          ...currentPiece,
          areaSqm,
        } as OtdPieceInfo);
        currentPiece = null;
      }
      currentSection = rawLine.substring(1, rawLine.length - 1).trim().toUpperCase();
      if (currentSection === 'INFO' || currentSection.startsWith('INFO')) {
        currentPiece = {};
      }
      continue;
    }

    const eqIdx = rawLine.indexOf('=');
    if (eqIdx !== -1) {
      const key = rawLine.substring(0, eqIdx).trim();
      const val = rawLine.substring(eqIdx + 1).trim();

      if (currentSection === 'HEADER') {
        if (key === 'OTDCutVersion') result.cutVersion = val;
        else if (key === 'Dimension') result.dimensionUnit = val;
        else if (key === 'Date') result.otdDate = val;
      } else if (currentSection === 'SIGNATURE') {
        if (key === 'Creator') result.creator = val;
        else if (key === 'OptimizationPrj') result.optimizationPrj = val;
      } else if (currentSection === 'PATTERN') {
        if (key === 'GlassID') result.glassId = val;
        else if (key === 'GlassThickness') result.glassThickness = parseFloat(val) || 0;
        else if (key === 'Pieces') result.programmedPieces = parseInt(val, 10) || 0;
        else if (key === 'Width') result.width = parseFloat(val) || 0;
        else if (key === 'Height') result.height = parseFloat(val) || 0;
        else if (key === 'TrimLeft') result.trimLeft = parseFloat(val) || 0;
        else if (key === 'TrimBottom') result.trimBottom = parseFloat(val) || 0;
      } else if (currentSection === 'INFO' || currentSection.startsWith('INFO')) {
        if (!currentPiece) currentPiece = {};
        if (key === 'Id') currentPiece.id = val;
        else if (key === 'OrderNo') currentPiece.orderNo = val;
        else if (key === 'PosNo') currentPiece.posNo = val;
        else if (key === 'Customer') currentPiece.customer = val;
        else if (key === 'SheetWidth') currentPiece.sheetWidth = parseFloat(val) || 0;
        else if (key === 'SheetHeight') currentPiece.sheetHeight = parseFloat(val) || 0;
        else if (key === 'SheetCode') currentPiece.sheetCode = val;
        else if (key === 'RackNo') currentPiece.rackNo = val;
      }
    }
  }

  // Push trailing piece
  if (currentPiece && (currentPiece.orderNo || currentPiece.sheetWidth)) {
    const w = currentPiece.sheetWidth || 0;
    const h = currentPiece.sheetHeight || 0;
    const areaSqm = (w / 1000) * (h / 1000);
    result.pieces.push({
      ...currentPiece,
      areaSqm,
    } as OtdPieceInfo);
  }

  // Calculate planned waste percentage if dimensions and pieces exist
  if (result.width && result.height && result.width > 0 && result.height > 0) {
    const motherAreaSqm = (result.width / 1000) * (result.height / 1000);
    const totalPieceArea = result.pieces.reduce((acc, p) => acc + (p.areaSqm || 0), 0);
    if (totalPieceArea > 0 && motherAreaSqm > totalPieceArea) {
      result.plannedWastePct = parseFloat((((motherAreaSqm - totalPieceArea) / motherAreaSqm) * 100).toFixed(2));
    }
  }

  return result;
}
