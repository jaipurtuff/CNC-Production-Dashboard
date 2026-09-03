import { ParsedZ01 } from './types.js';

export function parseZ01(buffer: Buffer): ParsedZ01 {
  const binarySizeBytes = buffer.length;

  // Extract printable ASCII strings of 6 or more characters
  const safeAsciiStrings: string[] = [];
  let currentRun: number[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    // Printable ASCII 32 to 126
    if (byte >= 32 && byte <= 126) {
      currentRun.push(byte);
    } else {
      if (currentRun.length >= 6) {
        safeAsciiStrings.push(Buffer.from(currentRun).toString('utf-8'));
      }
      currentRun = [];
    }
  }
  if (currentRun.length >= 6) {
    safeAsciiStrings.push(Buffer.from(currentRun).toString('utf-8'));
  }

  // Look for known path pattern (e.g. C:\Opty-Way\...)
  let referencedProjectPath: string | undefined;
  for (const str of safeAsciiStrings) {
    if (str.includes('Opty-Way') || str.endsWith('.R01')) {
      referencedProjectPath = str.trim();
      break;
    }
  }

  return {
    referencedProjectPath,
    safeAsciiStrings: safeAsciiStrings.slice(0, 50), // store reasonable sample
    binarySizeBytes,
    note: 'z01 binary content parsed safely without speculating on unconfirmed binary structures.',
  };
}
