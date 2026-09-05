import { FbtFieldDefinition, FbtSheetRecord, ParsedFbt } from './types.js';

export function parseFbt(content: string): ParsedFbt {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let lastWrite: string | null = null;
  const fields: FbtFieldDefinition[] = [];
  const sheets: FbtSheetRecord[] = [];
  const unresolvedFields: Record<string, string> = {};

  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('[LAST_WRITE=')) {
      const match = line.match(/\[LAST_WRITE=([^\]]+)\]/);
      if (match) {
        lastWrite = match[1].trim();
      }
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.toUpperCase();
      continue;
    }

    if (currentSection.includes('CAMPI')) {
      // e.g. CampoD0=Cod,A,256,11,NULL,0,0
      const match = line.match(/CampoD(\d+)=([^,]+),([^,]+),([^,]+),([^,]+)/);
      if (match) {
        fields.push({
          fieldIndex: parseInt(match[1], 10),
          name: match[2].trim(),
          type: match[3].trim(),
          length: match[4].trim(),
          decimals: match[5].trim(),
        });
      } else {
        unresolvedFields[`campi_line_${i}`] = line;
      }
      continue;
    }

    if (currentSection.includes('RIGHE')) {
      // e.g. 18-08-2026-A-06MM_CLEAR------1,3660,2770,6,1,1,0,1,F6
      const tokens = line.split(',').map(t => t.trim());
      if (tokens.length >= 6) {
        const sheetCode = tokens[0];
        // Extract 1-based index from suffix (e.g., ...1 -> 1, ...2 -> 2)
        const indexMatch = sheetCode.match(/(\d+)$/);
        const sheetIndex = indexMatch ? parseInt(indexMatch[1], 10) : sheets.length + 1;

        const dimX = parseFloat(tokens[1]) || 0;
        const dimY = parseFloat(tokens[2]) || 0;
        const thickness = parseFloat(tokens[3]) || 0;
        const quantityProgrammed = parseInt(tokens[4], 10) || 0;
        const quantityCut = parseInt(tokens[5], 10) || 0;
        const progressState = tokens.length > 6 ? parseInt(tokens[6], 10) || 0 : 0;
        const completionFlag = tokens.length > 7 ? parseInt(tokens[7], 10) || 0 : 0;
        const materialCode = tokens.length > 8 ? tokens[8] : '';

        // Confirmed logic:
        // - Layout is complete when Cnt >= Qta
        // - Layout is incomplete when Cnt < Qta
        // Do not guess the meaning of fields after Cnt (0,1,F5)
        const isCompleted = quantityCut >= quantityProgrammed;

        sheets.push({
          rawLine: line,
          sheetCode,
          sheetIndex,
          layoutIndex: sheetIndex,
          dimX,
          dimY,
          thickness,
          quantityProgrammed,
          quantityCut,
          progressState,
          completionFlag,
          materialCode,
          isCompleted,
        });
      } else {
        unresolvedFields[`righe_line_${i}`] = line;
      }
    }
  }

  const totalLayouts = sheets.length;
  const completedLayouts = sheets.filter(s => s.isCompleted).length;
  const totalPlannedSheets = sheets.reduce((sum, s) => sum + s.quantityProgrammed, 0);
  const totalCutSheets = sheets.reduce((sum, s) => sum + s.quantityCut, 0);
  const pendingSheets = sheets.reduce((sum, s) => sum + Math.max(0, s.quantityProgrammed - s.quantityCut), 0);

  return {
    lastWrite,
    fields,
    sheets,
    totalLayouts,
    completedLayouts,
    totalPlannedSheets,
    totalCutSheets,
    pendingSheets,
    totalSheets: totalPlannedSheets,
    completedSheets: totalCutSheets,
    unresolvedFields,
  };
}
