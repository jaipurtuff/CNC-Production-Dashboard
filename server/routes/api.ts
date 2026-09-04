import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { IDbClient } from '../db/index.js';
import { getDailyProduction, getJobTimeline } from '../engine/dailyMetrics.js';
import { runAllTests } from '../tests/testSuite.js';
import { CncMonitorService } from '../collector/cncMonitor.js';
import { GoogleSheetSyncService } from '../sync/googleSheetSync.js';

export function createApiRouter(
  db: IDbClient,
  cncMonitor: CncMonitorService,
  googleSync: GoogleSheetSyncService
): Router {
  const router = Router();

  // 1. CNC and System Status
  router.get('/status', async (req, res) => {
    try {
      const monitorRes = await db.query<{
        is_online: boolean;
        share_path: string;
        last_reachable_at: string | null;
        last_scan_at: string | null;
        active_job_id: string | null;
        current_sheet_index: number | null;
        total_jobs_tracked: number;
        error_message: string | null;
      }>('SELECT * FROM cnc_monitor_state WHERE id = 1');

      const syncRes = await db.query<{
        status: string;
        last_sync_time: string | null;
        rows_processed: number;
        new_rows: number;
        changed_rows: number;
        unchanged_rows: number;
        error_message: string | null;
      }>('SELECT * FROM order_sync_state WHERE id = 1');

      // Check active job details if active
      let activeJobDetails: any = null;
      const monitor = monitorRes.rows[0];
      if (monitor?.active_job_id) {
        const jobRes = await db.query<{
          job_id: string;
          material_code: string;
          sheet_thickness_mm: number;
          sheet_width_mm: number;
          sheet_height_mm: number;
          customer_name: string | null;
          order_no: string | null;
          total_programmed_sheets: number;
          last_seen_at: string;
        }>('SELECT * FROM cnc_jobs WHERE job_id = $1', [monitor.active_job_id]);

        if (jobRes.rows.length > 0) {
          const j = jobRes.rows[0];
          const completedRes = await db.query<{ count: string }>(
            "SELECT COUNT(DISTINCT sheet_index) as count FROM production_events WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'",
            [j.job_id]
          );
          const completedCount = parseInt(completedRes.rows[0]?.count || '0', 10);
          activeJobDetails = {
            ...j,
            completedSheets: completedCount,
            progressPct: j.total_programmed_sheets > 0
              ? Math.round((completedCount / j.total_programmed_sheets) * 100)
              : 0,
          };
        } else {
          // Self-heal orphaned active_job_id that does not exist in cnc_jobs (e.g. test artifacts)
          await db.query(
            'UPDATE cnc_monitor_state SET active_job_id = NULL, current_sheet_index = NULL WHERE id = 1 AND active_job_id = $1',
            [monitor.active_job_id]
          );
          monitor.active_job_id = null;
          monitor.current_sheet_index = null;
        }
      }

      res.json({
        database: {
          type: db.isPostgresServer ? 'PostgreSQL Server' : 'Local PostgreSQL Engine',
          isExternalPostgres: db.isPostgresServer,
        },
        cnc: {
          isOnline: monitor?.is_online ?? false,
          sharePath: monitor?.share_path || cncMonitor.getSharePath(),
          lastReachableAt: monitor?.last_reachable_at,
          lastScanAt: monitor?.last_scan_at,
          activeJobId: monitor?.active_job_id,
          currentSheetIndex: monitor?.current_sheet_index,
          totalJobsTracked: monitor?.total_jobs_tracked || 0,
          errorMessage: monitor?.error_message,
          activeJob: activeJobDetails,
        },
        orderSync: syncRes.rows[0] || {
          status: 'IDLE',
          rows_processed: 0,
        },
        serverTime: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Daily Production Metrics
  router.get('/production/daily', async (req, res) => {
    try {
      const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const data = await getDailyProduction(db, dateStr);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. List All Jobs
  router.get('/jobs', async (req, res) => {
    try {
      const jobsRes = await db.query<{
        job_id: string;
        base_filename: string;
        total_programmed_sheets: number;
        sheet_width_mm: string;
        sheet_height_mm: string;
        sheet_thickness_mm: string;
        material_code: string;
        customer_name: string | null;
        order_no: string | null;
        planned_waste_pct: string | null;
        filename_date: string | null;
        otd_date: string | null;
        fbt_last_write: string | null;
        first_detected_at: string;
        last_seen_at: string;
        status: string;
      }>('SELECT * FROM cnc_jobs ORDER BY last_seen_at DESC');

      const jobs = await Promise.all(
        jobsRes.rows.map(async (j) => {
          const compRes = await db.query<{ count: string }>(
            "SELECT COUNT(DISTINCT sheet_index) as count FROM production_events WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'",
            [j.job_id]
          );
          const completedSheets = parseInt(compRes.rows[0]?.count || '0', 10);
          const progressPct =
            j.total_programmed_sheets > 0
              ? Math.min(100, Math.round((completedSheets / j.total_programmed_sheets) * 100))
              : 0;

          return {
            ...j,
            completedSheets,
            progressPct,
            sheet_width_mm: parseFloat(j.sheet_width_mm),
            sheet_height_mm: parseFloat(j.sheet_height_mm),
            sheet_thickness_mm: parseFloat(j.sheet_thickness_mm),
            planned_waste_pct: j.planned_waste_pct ? parseFloat(j.planned_waste_pct) : null,
          };
        })
      );

      res.json({ jobs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Job Details with Timeline and Mother Sheets
  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const jobRes = await db.query('SELECT * FROM cnc_jobs WHERE job_id = $1', [jobId]);
      if (jobRes.rows.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }
      const job = jobRes.rows[0];

      const sheetsRes = await db.query(
        'SELECT * FROM cnc_mother_sheets WHERE job_id = $1 ORDER BY sheet_index ASC',
        [jobId]
      );

      const piecesRes = await db.query(
        'SELECT * FROM cnc_pieces WHERE job_id = $1 ORDER BY sheet_index ASC, id ASC',
        [jobId]
      );

      const timeline = await getJobTimeline(db, jobId);

      res.json({
        job,
        sheets: sheetsRes.rows,
        pieces: piecesRes.rows,
        timeline,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Work Orders (Google Sheet linked with CNC production)
  router.get('/orders', async (req, res) => {
    try {
      const ordersRes = await db.query<{
        id: number;
        customer_id: string | null;
        order_no: string | null;
        work_order_no: string;
        customer_name: string | null;
        total_required_pcs: number;
        total_cut_pcs: number;
        total_pending_pcs: number;
        overall_progress_pct: number;
        status: string | null;
        created_at: string;
        updated_at: string;
        row_sha256: string | null;
      }>('SELECT * FROM orders ORDER BY id ASC');

      const ordersWithProduction = await Promise.all(
        ordersRes.rows.map(async (o) => {
          // Check produced pieces matching this Work Order No.
          const prodRes = await db.query<{
            cut_pieces: string;
            job_id: string | null;
          }>(
            `SELECT
               COUNT(p.id) as cut_pieces,
               MAX(p.job_id) as job_id
             FROM cnc_pieces p
             WHERE p.order_no = $1 AND p.status = 'CUT'`,
            [o.work_order_no]
          );

          const cutPieces = parseInt(prodRes.rows[0]?.cut_pieces || '0', 10);
          const requiredPcs = Number(o.total_required_pcs || 0);
          const completionPct = requiredPcs > 0
            ? Math.min(100, Math.round((cutPieces / requiredPcs) * 100))
            : (Number(o.overall_progress_pct) || 0);

          return {
            ...o,
            work_order_no: o.work_order_no,
            wo_no: o.work_order_no, // alias for frontend backwards compatibility
            ref_code: o.order_no || '',
            material: '',
            ordered_pcs: requiredPcs,
            producedPieces: cutPieces,
            pendingPieces: Math.max(0, requiredPcs - cutPieces),
            completionPct,
            linkedJobId: prodRes.rows[0]?.job_id || null,
          };
        })
      );

      res.json({ orders: ordersWithProduction });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Traceability Drilldown
  router.get('/traceability', async (req, res) => {
    try {
      const { wo, jobId } = req.query;

      let query = `
        SELECT
          p.id as piece_id,
          p.order_no,
          p.pos_no,
          p.customer_name,
          p.sheet_index,
          p.width_mm as piece_width,
          p.height_mm as piece_height,
          p.area_sqm as piece_area,
          p.status as piece_status,
          p.completed_at as piece_completed_at,
          j.job_id,
          j.base_filename,
          j.material_code,
          j.sheet_width_mm as mother_width,
          j.sheet_height_mm as mother_height,
          ms.area_sqm as mother_area,
          pe.event_id,
          pe.event_timestamp,
          pe.production_date,
          pe.confidence
        FROM cnc_pieces p
        JOIN cnc_jobs j ON p.job_id = j.job_id
        LEFT JOIN cnc_mother_sheets ms ON p.job_id = ms.job_id AND p.sheet_index = ms.sheet_index
        LEFT JOIN production_events pe ON p.job_id = pe.job_id AND p.sheet_index = pe.sheet_index
      `;

      const params: any[] = [];
      const conditions: string[] = [];

      if (wo) {
        params.push(wo);
        conditions.push(`p.order_no = $${params.length}`);
      }
      if (jobId) {
        params.push(jobId);
        conditions.push(`p.job_id = $${params.length}`);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY pe.event_timestamp DESC NULLS LAST LIMIT 100`;

      const result = await db.query(query, params);
      res.json({ records: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. System Events & Audit Log
  router.get('/events', async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const eventsRes = await db.query(
        'SELECT * FROM system_events ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      res.json({ events: eventsRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Trigger Google Sheet Sync on Demand
  router.post('/sync/trigger', async (req, res) => {
    try {
      const result = await googleSync.performSync();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Trigger CNC Scan on Demand
  router.post('/scan/trigger', async (req, res) => {
    try {
      await cncMonitor.triggerManualScanNow();
      res.json({ success: true, message: 'CNC share scanned' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Run Automated Test Suite
  router.post('/tests/run', async (req, res) => {
    try {
      const summary = await runAllTests();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Interactive QA Simulation (Operates strictly in an isolated local test directory)
  // MANDATE: The live CNC share (\\192.168.11.211\iso) is STRICTLY READ-ONLY and will never be written to.
  router.post('/sandbox/step', async (req, res) => {
    try {
      const { scenario } = req.body;
      const shareDir = cncMonitor.getSharePath();

      // Guard against writing to UNC network shares
      if (shareDir.startsWith('\\\\') || shareDir.startsWith('//')) {
        return res.status(403).json({
          error: 'Forbidden: Live CNC network share (\\\\192.168.11.211\\iso) is strictly READ-ONLY. Simulation writing is restricted to local test environments.'
        });
      }

      if (scenario === 'day1_jobA_cut5') {
        // Cut sheets 1..5 of Job A
        const fbtContent = `[LAST_WRITE=01-09-2026 10:30:00]
[DISTINTA : CAMPI]
CampoD0=Cod,A,256,11,NULL,0,0
CampoD1=DimX,F,6.7,10,NULL,0,0
CampoD2=DimY,F,6.7,10,NULL,0,0
CampoD3=Spes,U,8,8,NULL,0,0
CampoD4=Qta,U,4,4,NULL,0,0
CampoD5=Cnt,U,4,4,NULL,0,0
[DISTINTA : RIGHE]
18-08-2026-A-06MM_CLEAR------1,3660,2770,6,1,1,0,1,F6
18-08-2026-A-06MM_CLEAR------2,3660,2770,6,1,1,1,2,F6
18-08-2026-A-06MM_CLEAR------3,3660,2770,6,1,1,2,3,F6
18-08-2026-A-06MM_CLEAR------4,3660,2770,6,1,1,3,4,F6
18-08-2026-A-06MM_CLEAR------5,3660,2770,6,1,1,4,5,F6
18-08-2026-A-06MM_CLEAR------6,3660,2770,6,1,0,5,0,F6
18-08-2026-A-06MM_CLEAR------7,3660,2770,6,1,0,6,0,F6
18-08-2026-A-06MM_CLEAR------8,3660,2770,6,1,0,7,0,F6
18-08-2026-A-06MM_CLEAR------9,3660,2770,6,1,0,8,0,F6
18-08-2026-A-06MM_CLEAR------10,3660,2770,6,1,0,9,0,F6
`;
        fs.writeFileSync(path.join(shareDir, '18-08-2026-A-06MM_CLEAR------.FBT'), fbtContent);
        await cncMonitor.triggerManualScanNow();
        return res.json({ success: true, message: 'Simulated Day 1: Job A cut 5 sheets' });
      }

      if (scenario === 'day1_jobB_cut2') {
        // Job B cut 2 sheets
        const fbtContent = `[LAST_WRITE=01-09-2026 14:15:00]
[DISTINTA : CAMPI]
CampoD0=Cod,A,256,11,NULL,0,0
CampoD1=DimX,F,6.7,10,NULL,0,0
CampoD2=DimY,F,6.7,10,NULL,0,0
CampoD3=Spes,U,8,8,NULL,0,0
CampoD4=Qta,U,4,4,NULL,0,0
CampoD5=Cnt,U,4,4,NULL,0,0
[DISTINTA : RIGHE]
25-08-2026-X-06MM_DSN-50--1,3660,2400,6,1,1,0,1,F6
25-08-2026-X-06MM_DSN-50--2,3660,2400,6,1,1,1,2,F6
25-08-2026-X-06MM_DSN-50--3,3660,2400,6,1,0,2,0,F6
25-08-2026-X-06MM_DSN-50--4,3660,2400,6,1,0,3,0,F6
`;
        fs.writeFileSync(path.join(shareDir, '25-08-2026-X-06MM_DSN-50--.FBT'), fbtContent);
        await cncMonitor.triggerManualScanNow();
        return res.json({ success: true, message: 'Simulated Day 1: Job B cut 2 sheets' });
      }

      if (scenario === 'day2_jobA_resume_cutAll') {
        // Job A resumes and completes all remaining 5 sheets (total 10)
        const fbtContent = `[LAST_WRITE=02-09-2026 11:20:00]
[DISTINTA : CAMPI]
CampoD0=Cod,A,256,11,NULL,0,0
CampoD1=DimX,F,6.7,10,NULL,0,0
CampoD2=DimY,F,6.7,10,NULL,0,0
CampoD3=Spes,U,8,8,NULL,0,0
CampoD4=Qta,U,4,4,NULL,0,0
CampoD5=Cnt,U,4,4,NULL,0,0
[DISTINTA : RIGHE]
18-08-2026-A-06MM_CLEAR------1,3660,2770,6,1,1,0,1,F6
18-08-2026-A-06MM_CLEAR------2,3660,2770,6,1,1,1,2,F6
18-08-2026-A-06MM_CLEAR------3,3660,2770,6,1,1,2,3,F6
18-08-2026-A-06MM_CLEAR------4,3660,2770,6,1,1,3,4,F6
18-08-2026-A-06MM_CLEAR------5,3660,2770,6,1,1,4,5,F6
18-08-2026-A-06MM_CLEAR------6,3660,2770,6,1,1,5,6,F6
18-08-2026-A-06MM_CLEAR------7,3660,2770,6,1,1,6,7,F6
18-08-2026-A-06MM_CLEAR------8,3660,2770,6,1,1,7,8,F6
18-08-2026-A-06MM_CLEAR------9,3660,2770,6,1,1,8,9,F6
18-08-2026-A-06MM_CLEAR------10,3660,2770,6,1,1,9,10,F6
`;
        fs.writeFileSync(path.join(shareDir, '18-08-2026-A-06MM_CLEAR------.FBT'), fbtContent);
        await cncMonitor.triggerManualScanNow();
        return res.json({ success: true, message: 'Simulated Day 2: Job A resumed and cut remaining 5 sheets (10 total)' });
      }

      res.status(400).json({ error: 'Unknown scenario' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
