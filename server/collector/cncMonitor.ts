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

interface DiscoveredFileWithStatus extends DiscoveredFile {
  isChanged: boolean;
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
  private isCacheInitialized: boolean = false;
  private cachedCorrelatedJobs = new Map<string, CorrelatedCncJob>();
  private knownJobsInDb = new Set<string>();

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

  private async initCache(): Promise<void> {
    if (this.isCacheInitialized) return;
    try {
      // Preload persistent file metadata from PostgreSQL cnc_job_files
      const filesRes = await this.db.query<{
        file_path: string;
        file_size_bytes: string | number;
        file_mtime: string | Date;
        content_sha256: string;
      }>('SELECT file_path, file_size_bytes, file_mtime, content_sha256 FROM cnc_job_files');

      for (const row of filesRes.rows) {
        if (row.file_path) {
          const mtimeMs = row.file_mtime
            ? (row.file_mtime instanceof Date ? row.file_mtime.getTime() : new Date(row.file_mtime).getTime())
            : 0;
          const normalized = path.normalize(row.file_path);
          const cacheEntry: FileTrackingCache = {
            size: Number(row.file_size_bytes),
            mtimeMs: isNaN(mtimeMs) ? 0 : mtimeMs,
            sha256: row.content_sha256 || '',
            isStable: true,
            firstSeenMs: Date.now(),
          };
          this.fileCache.set(normalized, cacheEntry);
          this.fileCache.set(row.file_path, cacheEntry);
          this.fileCache.set(row.file_path.replace(/\\/g, '/').toLowerCase(), cacheEntry);
          this.fileCache.set(path.basename(row.file_path).toLowerCase(), cacheEntry);
        }
      }

      const jobsRes = await this.db.query<{ job_id: string }>('SELECT job_id FROM cnc_jobs');
      for (const j of jobsRes.rows) {
        this.knownJobsInDb.add(j.job_id);
      }

      this.isCacheInitialized = true;
      console.log(`[CNC Monitor] Initialized persistent cache from PostgreSQL: ${this.fileCache.size} files, ${this.knownJobsInDb.size} known jobs`);
    } catch (err) {
      console.warn('[CNC Monitor] Notice: Preloading from cnc_job_files deferred to first scan:', err);
      this.isCacheInitialized = true;
    }
  }

  public async ensureCacheInitialized(): Promise<void> {
    await this.initCache();
  }

  public isPathCachedAsUnchanged(fullPath: string, size: number, mtimeMs: number): boolean {
    const normalized = path.normalize(fullPath);
    const cached = this.fileCache.get(normalized) || this.fileCache.get(fullPath);
    if (!cached) return false;
    return cached.size === size && Math.abs(cached.mtimeMs - mtimeMs) < 1000;
  }

  public isJobKnown(jobId: string): boolean {
    return this.knownJobsInDb.has(jobId);
  }

  public getCacheStats(): { filesCached: number; knownJobs: number } {
    return {
      filesCached: this.fileCache.size,
      knownJobs: this.knownJobsInDb.size,
    };
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
    this.cachedCorrelatedJobs.clear();
    this.isCacheInitialized = false;
  }

  private async performScan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      await this.initCache();
      const now = Date.now();
      let isReachable = false;
      let dirEntries: string[] = [];
      let reachabilityError: string | null = null;
      let effectiveScanDir = this.sharePath;

      try {
        // Strictly read-only directory check
        if (fs.existsSync(this.sharePath)) {
          dirEntries = fs.readdirSync(this.sharePath);
          isReachable = true;
          this.lastReachableTime = now;
        } else {
          // Local fallback for dev/container environments where UNC path (\\192.168.11.211\iso) is simulated locally
          const localFallback = path.resolve(process.cwd(), 'test_share');
          if (fs.existsSync(localFallback)) {
            effectiveScanDir = localFallback;
            dirEntries = fs.readdirSync(localFallback);
            isReachable = true;
            this.lastReachableTime = now;
          } else {
            reachabilityError = `Share path does not exist or is not accessible: ${this.sharePath}`;
          }
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

      // Discovered files matching .FBT, .OTD, .CNI, .z01
      const discovered: DiscoveredFileWithStatus[] = [];
      let entryIndex = 0;
      let changedFilesCount = 0;

      for (const entry of dirEntries) {
        const ext = path.extname(entry);
        const extUpper = ext.toUpperCase();
        if (!this.knownExtensions.has(extUpper)) continue;

        entryIndex++;
        // Cooperatively yield event loop every 25 files to keep HTTP server responsive during network I/O
        if (entryIndex % 25 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }

        const fullPath = path.join(effectiveScanDir, entry);
        try {
          // Strictly read-only stat
          const stat = fs.statSync(fullPath);
          const baseName = path.basename(entry, ext);

          const normalizedFullPath = path.normalize(fullPath);
          const cached =
            this.fileCache.get(normalizedFullPath) ||
            this.fileCache.get(fullPath) ||
            this.fileCache.get(fullPath.replace(/\\/g, '/').toLowerCase()) ||
            this.fileCache.get(entry.toLowerCase());

          let sha256 = cached?.sha256 || '';
          let isChanged = false;

          // Requirement 1: CNC monitor must continuously detect FBT file changes using filesystem metadata/mtime and/or content hash.
          // Requirement 2: When the FBT changes, it MUST re-read and parse the latest FBT contents.
          if (extUpper === '.FBT') {
            try {
              const content = fs.readFileSync(fullPath);
              sha256 = computeSha256(content);
            } catch (readErr) {
              sha256 = cached?.sha256 || '';
            }

            const isSizeDifferent = cached ? cached.size !== stat.size : true;
            const isMtimeDifferent = cached ? Math.abs(cached.mtimeMs - stat.mtimeMs) >= 1000 : true;
            const isHashDifferent = cached ? Boolean(cached.sha256 && sha256 && cached.sha256 !== sha256) : true;

            if (!cached || isHashDifferent || isMtimeDifferent || isSizeDifferent) {
              isChanged = true;
              changedFilesCount++;
            }
          } else {
            const isUnchanged =
              cached !== undefined &&
              cached.size === stat.size &&
              Math.abs(cached.mtimeMs - stat.mtimeMs) < 1000;

            if (!isUnchanged) {
              isChanged = true;
              changedFilesCount++;
              try {
                const content = fs.readFileSync(fullPath);
                sha256 = computeSha256(content);
              } catch (readErr) {
                sha256 = cached?.sha256 || '';
              }
            }
          }

          discovered.push({
            filename: entry,
            filePath: fullPath,
            ext: extUpper,
            baseName,
            size: stat.size,
            mtime: stat.mtime,
            sha256,
            isChanged,
          });
        } catch (fileErr) {
          // Skip inaccessible file in read-only scan
        }
      }

      // Group files by base name
      const groups = groupCncFiles(discovered);

      // Process only jobs that have changed files or are not yet known in PostgreSQL
      let jobsUpdatedCount = 0;

      for (const [baseName, files] of groups.entries()) {
        const hasChangedFile = (files as DiscoveredFileWithStatus[]).some(f => f.isChanged);
        const isKnownJob = this.knownJobsInDb.has(baseName);

        if (!hasChangedFile && isKnownJob) {
          // TRULY INCREMENTAL ACROSS SERVER RESTARTS:
          // Keep in-memory cache populated for active job determination across scans/restarts
          if (!this.cachedCorrelatedJobs.has(baseName)) {
            const correlatedJob = correlateJobFiles(baseName, files);
            this.cachedCorrelatedJobs.set(baseName, correlatedJob);
          }
          continue;
        }

        // Correlate files for this job
        const correlatedJob = correlateJobFiles(baseName, files);
        this.cachedCorrelatedJobs.set(baseName, correlatedJob);
        this.knownJobsInDb.add(baseName);
        jobsUpdatedCount++;

        // Process state transition in database
        await processJobStateTransition(this.db, correlatedJob, new Date(now));

        // Record or update changed files in cnc_job_files and commit to in-memory fileCache
        for (const file of files as DiscoveredFileWithStatus[]) {
          if (file.isChanged || !isKnownJob) {
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
                baseName,
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

            const cacheEntry: FileTrackingCache = {
              size: file.size,
              mtimeMs: file.mtime.getTime(),
              sha256: file.sha256,
              isStable: true,
              firstSeenMs: now,
            };
            this.fileCache.set(file.filePath, cacheEntry);
            this.fileCache.set(path.normalize(file.filePath), cacheEntry);
            this.fileCache.set(file.filePath.replace(/\\/g, '/').toLowerCase(), cacheEntry);
            this.fileCache.set(file.filename.toLowerCase(), cacheEntry);
          }
        }
      }

      // Active Job and Current Sheet identification (Issue 4):
      // Use the most recently updated .FBT file / sheet activity to determine currently active job.
      // Do NOT rely on filename dates.
      let activeJobId: string | null = null;
      let currentSheetIdx: number | null = null;

      const jobsWithFbt = Array.from(this.cachedCorrelatedJobs.values())
        .filter(j => j.files.fbt && (j.fbtUpdateTimestamp || j.files.fbt.mtime))
        .sort((a, b) => {
          const timeA = Math.max(
            (a.fbtUpdateTimestamp ? a.fbtUpdateTimestamp.getTime() : 0),
            (a.files.fbt?.mtime ? a.files.fbt.mtime.getTime() : 0)
          );
          const timeB = Math.max(
            (b.fbtUpdateTimestamp ? b.fbtUpdateTimestamp.getTime() : 0),
            (b.files.fbt?.mtime ? b.files.fbt.mtime.getTime() : 0)
          );
          return timeB - timeA;
        });

      if (jobsWithFbt.length > 0) {
        const newestJob = jobsWithFbt[0];
        const newestFbtTime = (newestJob.fbtUpdateTimestamp || newestJob.files.fbt!.mtime).getTime();
        const timeSinceLastFbtMs = now - newestFbtTime;

        if (newestJob.completedSheetsCount < newestJob.totalProgrammedSheets) {
          // Machine is currently running or paused on this job
          activeJobId = newestJob.jobId;
          currentSheetIdx = newestJob.currentLayoutIndex ?? newestJob.currentSheetIndex ?? null;
        } else if (timeSinceLastFbtMs < 30 * 60 * 1000) {
          // Recently finished within the last 30 minutes
          activeJobId = newestJob.jobId;
          currentSheetIdx = newestJob.currentLayoutIndex ?? (newestJob.totalLayouts || newestJob.totalProgrammedSheets);
        } else {
          // Machine is idle (no unfinished active job and no recent cutting activity)
          activeJobId = null;
          currentSheetIdx = null;
        }
      } else {
        // Fallback to persisted state in PostgreSQL (e.g. after server restart when unchanged jobs are skipped)
        try {
          const latestDbJobRes = await this.db.query<{
            job_id: string;
            total_programmed_sheets: number;
            total_layouts: number;
            current_layout_index: number | null;
            status: string;
            file_mtime: string | Date;
            completed_count: string | number;
          }>(
            `SELECT j.job_id, j.total_programmed_sheets, j.total_layouts, j.total_planned_sheets, j.total_cut_sheets, j.current_layout_index, j.status, f.file_mtime,
                    COALESCE(
                      (SELECT SUM(cnt) FROM cnc_layouts WHERE job_id = j.job_id),
                      j.total_cut_sheets,
                      0
                    ) as completed_count
             FROM cnc_jobs j
             JOIN cnc_job_files f ON f.job_id = j.job_id AND f.file_type = 'FBT'
             ORDER BY f.file_mtime DESC
             LIMIT 1`
          );

          if (latestDbJobRes.rows.length > 0) {
            const row = latestDbJobRes.rows[0];
            const completedSheets = Number(row.completed_count);
            const totalSheets = Number(row.total_programmed_sheets);
            const fbtTime = row.file_mtime instanceof Date
              ? row.file_mtime.getTime()
              : new Date(row.file_mtime).getTime();
            const timeSinceLastFbtMs = now - fbtTime;

            if (totalSheets > 0 && completedSheets < totalSheets) {
              activeJobId = row.job_id;
              // Find the logical next incomplete layout from cnc_layouts where cnt < qta
              try {
                const nextIncompleteRes = await this.db.query<{ layout_index: number }>(
                  `SELECT layout_index FROM cnc_layouts WHERE job_id = $1 AND cnt < qta ORDER BY layout_index ASC LIMIT 1`,
                  [row.job_id]
                );
                currentSheetIdx = nextIncompleteRes.rows[0]?.layout_index ?? row.current_layout_index ?? null;
              } catch (layoutErr: any) {
                currentSheetIdx = row.current_layout_index ?? null;
              }
            } else if (timeSinceLastFbtMs < 30 * 60 * 1000) {
              activeJobId = row.job_id;
              currentSheetIdx = row.current_layout_index ?? row.total_layouts ?? totalSheets;
            } else {
              activeJobId = null;
              currentSheetIdx = null;
            }
          }
        } catch (dbErr) {
          // If query fails (e.g. table empty), leave activeJobId as null
        }
      }

      // Update state singleton with active job details and total jobs tracked
      await this.db.query(
        `UPDATE cnc_monitor_state
         SET active_job_id = $1,
             current_sheet_index = $2,
             total_jobs_tracked = $3,
             error_message = NULL
         WHERE id = 1`,
        [activeJobId, currentSheetIdx, this.knownJobsInDb.size]
      );

      const elapsedMs = Date.now() - now;
      if (changedFilesCount > 0 || jobsUpdatedCount > 0) {
        console.log(
          `[CNC Monitor] Scan completed in ${elapsedMs}ms: ${discovered.length} total files, ${changedFilesCount} changed files, ${jobsUpdatedCount} jobs updated`
        );
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
