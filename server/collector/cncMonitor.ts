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
    this.sharePath = this.normalizeSharePath(sharePath);
    this.scanIntervalMs = scanIntervalMs;
    this.offlineGraceSec = offlineGraceSec;

    // READ-ONLY MANDATE: Under NO circumstances should this service create or write files to the CNC network share
  }

  private normalizeSharePath(rawPath: string): string {
    // Preserve Windows UNC network paths exactly as-is (e.g. \\192.168.11.211\iso)
    if (rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
      return rawPath;
    }
    return path.resolve(process.cwd(), rawPath);
  }

  public start() {
    if (this.timer) return;
    console.log(`[CNC Monitor] Starting continuous read-only background monitor on: ${this.sharePath}`);
    // Initial immediate scan
    this.performScan().catch(err => console.error('[CNC Monitor] Error in initial scan:', err));
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

      try {
        // Strictly read-only directory check
        if (fs.existsSync(this.sharePath)) {
          dirEntries = fs.readdirSync(this.sharePath);
          isReachable = true;
          this.lastReachableTime = now;
        }
      } catch (err: any) {
        isReachable = false;
      }

      // Evaluate reachability & grace period
      const secondsSinceReachable = (now - this.lastReachableTime) / 1000;
      const shouldBeOnline = isReachable || secondsSinceReachable < this.offlineGraceSec;

      if (shouldBeOnline !== this.isCurrentlyOnline) {
        this.isCurrentlyOnline = shouldBeOnline;
        await this.db.query(
          `UPDATE cnc_monitor_state
           SET is_online = $1, last_reachable_at = $2, last_scan_at = $3, share_path = $4
           WHERE id = 1`,
          [
            shouldBeOnline,
            new Date(this.lastReachableTime).toISOString(),
            new Date(now).toISOString(),
            this.sharePath,
          ]
        );

        await this.db.query(
          `INSERT INTO system_events (event_type, message, created_at)
           VALUES ($1, $2, $3)`,
          [
            shouldBeOnline ? 'CNC_ONLINE' : 'CNC_OFFLINE',
            shouldBeOnline
              ? `CNC Share is online and reachable at ${this.sharePath}`
              : `CNC Share is OFFLINE. Unable to reach ${this.sharePath} (grace period exceeded)`,
            new Date(now).toISOString(),
          ]
        );
      } else {
        await this.db.query(
          `UPDATE cnc_monitor_state
           SET last_scan_at = $1, share_path = $2
           WHERE id = 1`,
          [new Date(now).toISOString(), this.sharePath]
        );
      }

      if (!isReachable) {
        this.isScanning = false;
        return;
      }

      // Discovered files matching .FBT, .OTD, .CNI, .z01
      const discovered: DiscoveredFile[] = [];

      for (const entry of dirEntries) {
        const ext = path.extname(entry);
        const extUpper = ext.toUpperCase();
        if (!this.knownExtensions.has(extUpper)) continue;

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
             total_jobs_tracked = $3
         WHERE id = 1`,
        [activeJobId, currentSheetIdx, correlatedJobs.length]
      );
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
