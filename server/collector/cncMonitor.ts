import fs from 'fs';
import path from 'path';
import { IDbClient } from '../db/index.js';
import { DiscoveredFile, computeSha256, groupCncFiles, correlateJobFiles } from '../parsers/jobCorrelator.js';
import { CorrelatedCncJob } from '../parsers/types.js';
import { processJobStateTransition } from '../engine/stateComparator.js';

interface FileTrackingCache {
  size: number;
  mtimeMs: number;
  sha256: string;
  isStable: boolean;
  firstSeenMs: number;
}

export function normalizeSharePath(rawPath: string): string {
  if (!rawPath) return '';
  let clean = rawPath.trim();

  // Strip surrounding quotes (both double and single)
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }

  // If path was escaped with 4+ leading backslashes: e.g. \\\\server\\share
  if (clean.startsWith('\\\\\\\\')) {
    clean = '\\\\' + clean.slice(4).replace(/\\\\/g, '\\');
  }

  // Convert forward slash UNC (//server/share) to backslash (\\server\share)
  if (clean.startsWith('//')) {
    clean = '\\\\' + clean.slice(2).replace(/\//g, '\\');
  }

  // If it starts with two backslashes: standard Windows UNC path
  if (clean.startsWith('\\\\')) {
    return '\\\\' + clean.slice(2).replace(/\\\\+/g, '\\').replace(/\//g, '\\');
  }

  // If leading double backslash was reduced to a single backslash by shell or dotenv escape:
  // e.g. \192.168.11.211\iso or \192.168.11.211/iso
  // UNC path format has server and share: \host\share...
  if (/^\\[a-zA-Z0-9_.-]+[\\/]/.test(clean)) {
    const withoutLeading = clean.slice(1);
    return '\\\\' + withoutLeading.replace(/\\\\+/g, '\\').replace(/\//g, '\\');
  }

  // If it's a Windows drive letter path (e.g. C:\... or D:/...)
  if (/^[a-zA-Z]:[\\/]/.test(clean)) {
    return clean;
  }

  // Relative or Unix absolute path
  return path.resolve(process.cwd(), clean);
}

export class CncMonitorService {
  private db: IDbClient;
  private sharePath: string;
  private scanIntervalMs: number;
  private offlineGraceSec: number;
  private timer: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;
  private lastReachableTime: number = Date.now();
  private isCurrentlyOnline: boolean = false;
  private fileCache = new Map<string, FileTrackingCache>();
  private knownExtensions = new Set(['.FBT', '.OTD', '.CNI', '.Z01']);

  constructor(
    db: IDbClient,
    sharePath: string = process.env.CNC_SHARE_PATH || '\\\\192.168.11.211\\iso',
    scanIntervalMs: number = parseInt(process.env.CNC_SCAN_INTERVAL_MS || '5000', 10),
    offlineGraceSec: number = parseInt(process.env.CNC_OFFLINE_GRACE_SEC || '30', 10)
  ) {
    this.db = db;
    this.sharePath = normalizeSharePath(sharePath);
    this.scanIntervalMs = scanIntervalMs;
    this.offlineGraceSec = offlineGraceSec;

    // READ-ONLY MANDATE: Under NO circumstances should this service create or write files to the CNC network share
  }

  private normalizeSharePath(rawPath: string): string {
    return normalizeSharePath(rawPath);
  }

  public start() {
    if (this.timer) return;
    console.log(`[CNC Monitor] Starting continuous read-only background monitor on: ${this.sharePath}`);
    // Initial scan scheduled asynchronously on next event loop tick so start() never blocks caller
    setImmediate(() => {
      this.performScan().catch(err => console.error('[CNC Monitor] Error in initial scan:', err));
    });
    // Continuous polling interval
    this.timer = setInterval(() => {
      this.performScan().catch(err => console.error('[CNC Monitor] Error in scan cycle:', err));
    }, this.scanIntervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[CNC Monitor] Stopped background monitor');
    }
  }

  public async triggerManualScanNow(): Promise<void> {
    await this.performScan();
  }

  public getSharePath(): string {
    return this.sharePath;
  }

  public setSharePath(newPath: string) {
    this.sharePath = this.normalizeSharePath(newPath);
    this.fileCache.clear();
  }

  private async performScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const now = Date.now();
      let isReachable = false;
      let dirEntries: string[] = [];
      let reachabilityError: string | null = null;

      try {
        // Strictly read-only directory check
        if (fs.existsSync(this.sharePath)) {
          dirEntries = fs.readdirSync(this.sharePath);
          isReachable = true;
          this.lastReachableTime = now;
        } else {
          reachabilityError = `Share path does not exist or is not accessible: ${this.sharePath}`;
        }
      } catch (err: any) {
        isReachable = false;
        reachabilityError = `Cannot access share '${this.sharePath}': ${err?.message || err}`;
      }

      if (!isReachable && reachabilityError) {
        console.warn(`[CNC Monitor] ${reachabilityError}`);
      }

      // Evaluate reachability & grace period
      const secondsSinceReachable = (now - this.lastReachableTime) / 1000;
      const shouldBeOnline = isReachable || secondsSinceReachable < this.offlineGraceSec;

      if (shouldBeOnline !== this.isCurrentlyOnline) {
        this.isCurrentlyOnline = shouldBeOnline;
        await this.db.query(
          `UPDATE cnc_monitor_state
           SET is_online = $1, last_reachable_at = $2, last_scan_at = $3, share_path = $4, error_message = $5
           WHERE id = 1`,
          [
            shouldBeOnline,
            new Date(this.lastReachableTime).toISOString(),
            new Date(now).toISOString(),
            this.sharePath,
            isReachable ? null : reachabilityError,
          ]
        );

        await this.db.query(
          `INSERT INTO system_events (event_type, message, created_at)
           VALUES ($1, $2, $3)`,
          [
            shouldBeOnline ? 'CNC_ONLINE' : 'CNC_OFFLINE',
            shouldBeOnline
              ? `CNC Share is online and reachable at ${this.sharePath}`
              : `CNC Share is OFFLINE. Unable to reach ${this.sharePath} (grace period exceeded)${reachabilityError ? ' - ' + reachabilityError : ''}`,
            new Date(now).toISOString(),
          ]
        );
      } else {
        await this.db.query(
          `UPDATE cnc_monitor_state
           SET last_scan_at = $1, share_path = $2, error_message = $3
           WHERE id = 1`,
          [
            new Date(now).toISOString(),
            this.sharePath,
            isReachable ? null : reachabilityError,
          ]
        );
      }

      if (!isReachable) {
        this.isScanning = false;
        return;
      }

      // Log reachability and enumeration counts
      console.log(`[CNC Monitor] Scanning ${this.sharePath} (${dirEntries.length} directory entries found)`);

      // Discovered files matching .FBT, .OTD, .CNI, .z01
      const discovered: DiscoveredFile[] = [];
      let entryIndex = 0;

      for (const entry of dirEntries) {
        const ext = path.extname(entry);
        const extUpper = ext.toUpperCase();
        if (!this.knownExtensions.has(extUpper)) continue;

        entryIndex++;
        // Cooperatively yield event loop every 20 files to keep HTTP server responsive during network I/O
        if (entryIndex % 20 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }

        const fullPath = path.join(this.sharePath, entry);
        try {
          // Strictly read-only stat
          const stat = fs.statSync(fullPath);
          const baseName = path.basename(entry, ext);

          // Stability check: file must not have been modified within the last 300ms
          const fileAgeMs = now - stat.mtimeMs;
          const isStable = fileAgeMs >= 300;

          const cached = this.fileCache.get(fullPath);
          let sha256 = cached?.sha256 || '';

          // Only re-compute hash if file size or mtime changed (Incremental scanning efficiency)
          if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
            try {
              // Strictly read-only file read
              const content = fs.readFileSync(fullPath);
              sha256 = computeSha256(content);
            } catch (readErr) {
              // File might be briefly locked for reading by CNC controller
              sha256 = cached?.sha256 || '';
            }

            this.fileCache.set(fullPath, {
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              sha256,
              isStable,
              firstSeenMs: cached?.firstSeenMs || now,
            });
          }

          discovered.push({
            filename: entry,
            filePath: fullPath,
            ext: extUpper,
            baseName,
            size: stat.size,
            mtime: stat.mtime,
            sha256,
          });
        } catch (fileErr) {
          // Skip inaccessible file in read-only scan
        }
      }

      // Group and correlate jobs
      const groups = groupCncFiles(discovered);
      const correlatedJobs: CorrelatedCncJob[] = [];
      for (const [baseName, files] of groups.entries()) {
        correlatedJobs.push(correlateJobFiles(baseName, files));
      }

      // Process incremental state transition for each detected job
      let activeJobId: string | null = null;
      let currentSheetIdx: number | null = null;

      for (const job of correlatedJobs) {
        await processJobStateTransition(this.db, job, new Date(now));

        // Record discovered files into cnc_job_files table
        const jobFiles = discovered.filter(f => f.baseName === job.jobId);
        for (const file of jobFiles) {
          const fileType = file.ext.replace('.', '').toUpperCase();
          await this.db.query(
            `INSERT INTO cnc_job_files (
               job_id, file_type, filename, file_path, file_size_bytes, file_mtime, content_sha256, last_read_at, is_stable
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
             ON CONFLICT (job_id, file_type) DO UPDATE
             SET filename = EXCLUDED.filename,
                 file_path = EXCLUDED.file_path,
                 file_size_bytes = EXCLUDED.file_size_bytes,
                 file_mtime = EXCLUDED.file_mtime,
                 content_sha256 = EXCLUDED.content_sha256,
                 last_read_at = EXCLUDED.last_read_at,
                 is_stable = EXCLUDED.is_stable`,
            [
              job.jobId,
              fileType,
              file.filename,
              file.filePath,
              file.size,
              file.mtime.toISOString(),
              file.sha256,
              new Date(now).toISOString(),
            ]
          ).catch((fileDbErr) => {
            console.warn(`[CNC Monitor] Could not record file ${file.filename} in cnc_job_files:`, fileDbErr?.message || fileDbErr);
          });
        }

        // Determine current active job (most recently modified job that has remaining sheets)
        if (job.completedSheetsCount < job.totalProgrammedSheets) {
          activeJobId = job.jobId;
          currentSheetIdx = job.completedSheetsCount + 1;
        }
      }

      // Update state singleton with active job details
      await this.db.query(
        `UPDATE cnc_monitor_state
         SET active_job_id = $1,
             current_sheet_index = $2,
             total_jobs_tracked = $3,
             error_message = NULL
         WHERE id = 1`,
        [activeJobId, currentSheetIdx, correlatedJobs.length]
      );

      const elapsedMs = Date.now() - now;
      if (discovered.length > 0 || correlatedJobs.length > 0) {
        console.log(`[CNC Monitor] Scan cycle completed in ${elapsedMs}ms: ${discovered.length} CNC files matched, ${correlatedJobs.length} jobs tracked`);
      }
    } catch (err: any) {
      console.error('[CNC Monitor] Scan cycle failed:', err);
      await this.db.query(
        `UPDATE cnc_monitor_state
         SET error_message = $1
         WHERE id = 1`,
        [err?.message || String(err)]
      );
    } finally {
      this.isScanning = false;
    }
  }
}
