import { ParsedCni } from './types.js';

export function parseCni(content: string): ParsedCni {
  const lines = content.split(/\r?\n/);
  const result: ParsedCni = {
    rawIsoCommands: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith(';')) {
      const comment = trimmed.substring(1).trim();
      const colonIdx = comment.indexOf(':');
      if (colonIdx !== -1) {
        const key = comment.substring(0, colonIdx).trim().toLowerCase();
        const val = comment.substring(colonIdx + 1).trim();
        if (key === 'project') result.project = val;
        else if (key === 'material') result.material = val;
        else if (key === 'creator') result.creator = val;
        else if (key === 'version') result.version = val;
      }
      continue;
    }

    if (trimmed.startsWith('N')) {
      result.rawIsoCommands.push(trimmed);

      // Check for LX, LY, LZ
      // e.g. N10 G71 LX=3660 LY=2770 LZ=6 P103=131
      const lxMatch = trimmed.match(/LX=([0-9.]+)/);
      if (lxMatch) result.lx = parseFloat(lxMatch[1]);

      const lyMatch = trimmed.match(/LY=([0-9.]+)/);
      if (lyMatch) result.ly = parseFloat(lyMatch[1]);

      const lzMatch = trimmed.match(/LZ=([0-9.]+)/);
      if (lzMatch) result.lz = parseFloat(lzMatch[1]);

      const p103Match = trimmed.match(/P103=([0-9.]+)/);
      if (p103Match) result.p103 = parseFloat(p103Match[1]);

      // Check for subroutine reference
      // e.g. N40 ST50="18-08-2026-A-06MM CLEAR------.R01"
      const stMatch = trimmed.match(/ST\d+="([^"]+)"/);
      if (stMatch) result.subroutinePrj = stMatch[1];
    }
  }

  return result;
}
