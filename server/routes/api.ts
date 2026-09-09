import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { IDbClient } from '../db/index.js';
import { getDailyProduction, getJobTimeline } from '../engine/dailyMetrics.js';
import { runAllTests } from '../tests/testSuite.js';
import { CncMonitorService, cncEventEmitter } from '../collector/cncMonitor.js';
import { GoogleSheetSyncService } from '../sync/googleSheetSync.js';
import { calculateProductionSqmMm } from '../engine/productionUnits.js';

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
        collector_state: string;
        share_path: string;
        last_reachable_at: string | null;
        last_scan_at: string | null;
        last_production_event_at: string | null;
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

      // Most recent production event
      const lastEventRes = await db.query<{
        event_id: number;
        job_id: string;
        sheet_index: number;
        production_date: string;
        event_timestamp: string;
        pieces_count: number;
        area_sqm: string;
        production_sqm_mm: string;
      }>(
        `SELECT event_id, job_id, sheet_index, production_date, event_timestamp, pieces_count, area_sqm, production_sqm_mm
         FROM production_events
         WHERE event_type = 'SHEET_COMPLETED'
         ORDER BY event_timestamp DESC
         LIMIT 1`
      );
      const lastEvent = lastEventRes.rows[0] ? {
        eventId: lastEventRes.rows[0].event_id,
        jobId: lastEventRes.rows[0].job_id,
        sheetIndex: lastEventRes.rows[0].sheet_index,
        productionDate: lastEventRes.rows[0].production_date,
        eventTimestamp: lastEventRes.rows[0].event_timestamp,
        piecesCount: lastEventRes.rows[0].pieces_count,
        areaSqm: parseFloat(parseFloat(lastEventRes.rows[0].area_sqm).toFixed(4)),
        productionSqmMm: parseFloat(parseFloat(lastEventRes.rows[0].production_sqm_mm || '0').toFixed(4)),
      } : null;

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

          // Retain all distinct customers for active job from pieces & orders (Issue 3)
          const pieceCustRes = await db.query<{ customer_name: string }>(
            "SELECT DISTINCT customer_name FROM cnc_pieces WHERE job_id = $1 AND customer_name IS NOT NULL AND customer_name != ''",
            [j.job_id]
          );
          const pieceCusts = pieceCustRes.rows.map(r => r.customer_name.trim()).filter(Boolean);
          const jobCusts = (j.customer_name || '').split(',').map(s => s.trim()).filter(Boolean);
          const distinctCusts = Array.from(new Set([...jobCusts, ...pieceCusts]));

          // Query layout breakdown from cnc_layouts
          let layouts: any[] = [];
          try {
            const layoutsRes = await db.query<{
              layout_index: number;
              layout_code: string;
              dim_x: number;
              dim_y: number;
              thickness_mm: number;
              qta: number;
              cnt: number;
              status: string;
            }>(
              `SELECT layout_index, layout_code, dim_x, dim_y, thickness_mm, qta, cnt, status
               FROM cnc_layouts
               WHERE job_id = $1
               ORDER BY layout_index ASC`,
              [j.job_id]
            );
            layouts = layoutsRes.rows;
          } catch (layoutErr: any) {
            console.warn(`[API] Note: unable to query cnc_layouts for job ${j.job_id}:`, layoutErr.message);
            layouts = [];
          }
          const totalLayouts = layouts.length || (j as any).total_layouts || 0;
          const totalPlannedSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Number(l.qta), 0)
            : ((j as any).total_planned_sheets || j.total_programmed_sheets || 0);
          const totalCutSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Number(l.cnt), 0)
            : (Number((j as any).total_cut_sheets) || 0);
          const totalPendingSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Math.max(0, Number(l.qta) - Number(l.cnt)), 0)
            : Math.max(0, totalPlannedSheets - totalCutSheets);

          // Canonical production m²-mm calculations
          const productionSqmMmCut = layouts.length > 0
            ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.cnt)), 0).toFixed(4))
            : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalCutSheets).toFixed(4));

          const productionSqmMmPlanned = layouts.length > 0
            ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.qta)), 0).toFixed(4))
            : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalPlannedSheets).toFixed(4));

          const productionSqmMmPending = parseFloat(Math.max(0, productionSqmMmPlanned - productionSqmMmCut).toFixed(4));

          // Get filesystem mtime for FBT file
          const fbtFileRes = await db.query<{ file_mtime: string | Date }>(
            "SELECT file_mtime FROM cnc_job_files WHERE job_id = $1 AND file_type = 'FBT'",
            [j.job_id]
          );
          const fbtFileMtime = (j as any).fbt_file_mtime || fbtFileRes.rows[0]?.file_mtime || null;

          // Find the logical next incomplete layout where Cnt < Qta
          const nextIncompleteLayout = layouts.find(l => Number(l.cnt) < Number(l.qta));
          const currentLayout = nextIncompleteLayout || (layouts.length > 0 ? layouts[layouts.length - 1] : null);
          const currentLayoutIndex = currentLayout?.layout_index ?? monitor.current_sheet_index;

          activeJobDetails = {
            ...j,
            fbt_last_write: (j as any).fbt_last_write || null,
            fbt_file_mtime: fbtFileMtime,
            customer_name: distinctCusts.join(', ') || j.customer_name,
            customerNames: distinctCusts,
            total_layouts: totalLayouts,
            total_planned_sheets: totalPlannedSheets,
            total_cut_sheets: totalCutSheets,
            total_pending_sheets: totalPendingSheets,
            productionSqmMmPlanned,
            productionSqmMmCut,
            productionSqmMmPending,
            current_layout_index: currentLayoutIndex,
            current_layout: currentLayout ? {
              layoutIndex: currentLayout.layout_index,
              layoutCode: currentLayout.layout_code,
              qta: Number(currentLayout.qta),
              cnt: Number(currentLayout.cnt),
              dimX: Number(currentLayout.dim_x),
              dimY: Number(currentLayout.dim_y),
              thickness: Number(currentLayout.thickness_mm),
              productionSqmMm: calculateProductionSqmMm(Number(currentLayout.dim_x), Number(currentLayout.dim_y), Number(currentLayout.thickness_mm), Number(currentLayout.cnt)),
              isCompleted: Number(currentLayout.cnt) >= Number(currentLayout.qta),
            } : null,
            layouts: layouts.map(l => ({
              layoutIndex: l.layout_index,
              layoutCode: l.layout_code,
              qta: Number(l.qta),
              cnt: Number(l.cnt),
              dimX: Number(l.dim_x),
              dimY: Number(l.dim_y),
              thickness: Number(l.thickness_mm),
              productionSqmMmCut: calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.cnt)),
              productionSqmMmPlanned: calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.qta)),
              isCompleted: Number(l.cnt) >= Number(l.qta),
            })),
            completedSheets: totalCutSheets,
            total_programmed_sheets: totalPlannedSheets,
            progressPct: totalPlannedSheets > 0
              ? Math.round((totalCutSheets / totalPlannedSheets) * 100)
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

      const collectorState = monitor?.collector_state || (monitor?.is_online ? (monitor?.active_job_id ? 'LIVE' : 'STALE') : 'OFFLINE');

      res.json({
        database: {
          type: db.isPostgresServer ? 'PostgreSQL Server' : 'Local PostgreSQL Engine',
          isExternalPostgres: db.isPostgresServer,
        },
        cnc: {
          isOnline: monitor?.is_online ?? false,
          collectorState,
          sharePath: monitor?.share_path || cncMonitor.getSharePath(),
          lastReachableAt: monitor?.last_reachable_at,
          lastScanAt: monitor?.last_scan_at,
          lastProductionEventAt: monitor?.last_production_event_at || lastEvent?.eventTimestamp || null,
          activeJobId: monitor?.active_job_id,
          currentSheetIndex: monitor?.current_sheet_index,
          totalJobsTracked: monitor?.total_jobs_tracked || 0,
          errorMessage: monitor?.error_message,
          activeJob: activeJobDetails,
          lastProductionEvent: lastEvent,
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

  // 2. Real-Time SSE Stream (Section 39)
  router.get('/live/stream', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendData = (eventType: string, data: any) => {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendData('connected', { time: new Date().toISOString() });

    const onScanComplete = (data: any) => sendData('scan_complete', data);
    const onScanError = (data: any) => sendData('scan_error', data);
    const onStateUpdate = (data: any) => sendData('state_update', data);

    cncEventEmitter.on('scan_complete', onScanComplete);
    cncEventEmitter.on('scan_error', onScanError);
    cncEventEmitter.on('state_update', onStateUpdate);

    const pingTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      cncEventEmitter.off('scan_complete', onScanComplete);
      cncEventEmitter.off('scan_error', onScanError);
      cncEventEmitter.off('state_update', onStateUpdate);
    });
  });

  // 3. Daily Production Metrics
  router.get('/production/daily', async (req, res) => {
    try {
      const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const data = await getDailyProduction(db, dateStr);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/production/today', async (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const data = await getDailyProduction(db, today);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Production History Over Time
  router.get('/production/history', async (req, res) => {
    try {
      const daysLimit = Math.min(60, Math.max(7, parseInt((req.query.days as string) || '30', 10)));
      const historyRes = await db.query<{
        production_date: string;
        sheets_count: string;
        pieces_count: string;
        total_area: string;
        total_sqm_mm: string;
        distinct_jobs: string;
      }>(
        `SELECT
           production_date,
           COUNT(DISTINCT CONCAT(job_id, '-', sheet_index)) as sheets_count,
           COALESCE(SUM(pieces_count), 0) as pieces_count,
           COALESCE(SUM(area_sqm), 0) as total_area,
           COALESCE(SUM(production_sqm_mm), 0) as total_sqm_mm,
           COUNT(DISTINCT job_id) as distinct_jobs
         FROM production_events
         WHERE event_type = 'SHEET_COMPLETED'
         GROUP BY production_date
         ORDER BY production_date DESC
         LIMIT $1`,
        [daysLimit]
      );

      const history = historyRes.rows.map(r => ({
        date: r.production_date,
        motherSheetsCut: parseInt(r.sheets_count || '0', 10),
        piecesCut: parseInt(r.pieces_count || '0', 10),
        areaSqm: parseFloat(parseFloat(r.total_area || '0').toFixed(4)),
        productionSqmMm: parseFloat(parseFloat(r.total_sqm_mm || '0').toFixed(4)),
        activeJobsCount: parseInt(r.distinct_jobs || '0', 10),
      }));

      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. List Jobs with Server-Side Pagination and Aggregation (Issue 1)
  router.get('/jobs', async (req, res) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(100, Math.max(10, parseInt((req.query.limit as string) || '50', 10)));
      const offset = (page - 1) * limit;
      const search = ((req.query.search as string) || '').trim();

      let whereClause = '';
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereClause = `WHERE j.job_id ILIKE $1 OR j.customer_name ILIKE $1 OR j.order_no ILIKE $1 OR j.material_code ILIKE $1`;
      }

      // Total count query
      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM cnc_jobs j ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      // Fast single query with aggregated completed_sheets count
      const queryParams = search ? [params[0], limit, offset] : [limit, offset];
      const limitOffsetIdx = search ? '$2 OFFSET $3' : '$1 OFFSET $2';

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
        completed_sheets: string;
      }>(
        `SELECT
           j.*,
           COALESCE(pe.completed_count, 0) as completed_sheets
         FROM cnc_jobs j
         LEFT JOIN (
           SELECT job_id, COUNT(DISTINCT sheet_index) as completed_count
           FROM production_events
           WHERE event_type = 'SHEET_COMPLETED'
           GROUP BY job_id
         ) pe ON pe.job_id = j.job_id
         ${whereClause}
         ORDER BY j.last_seen_at DESC
         LIMIT ${limitOffsetIdx}`,
        queryParams
      );

      const jobs = jobsRes.rows.map((j) => {
        const completedSheets = parseInt(j.completed_sheets || '0', 10);
        const progressPct =
          j.total_programmed_sheets > 0
            ? Math.min(100, Math.round((completedSheets / j.total_programmed_sheets) * 100))
            : 0;

        const customerNames = (j.customer_name || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        return {
          ...j,
          customerNames,
          completedSheets,
          progressPct,
          sheet_width_mm: parseFloat(j.sheet_width_mm) || 0,
          sheet_height_mm: parseFloat(j.sheet_height_mm) || 0,
          sheet_thickness_mm: parseFloat(j.sheet_thickness_mm) || 0,
          planned_waste_pct: j.planned_waste_pct ? parseFloat(j.planned_waste_pct) : null,
        };
      });

      res.json({
        jobs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
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

  // 5. CNC Program File Cards & File Details (Section 27, 28, 29)
  router.get('/cnc/files', async (req, res) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(100, Math.max(10, parseInt((req.query.limit as string) || '24', 10)));
      const offset = (page - 1) * limit;
      const search = ((req.query.search as string) || '').trim();
      const statusFilter = ((req.query.status as string) || 'ALL').toUpperCase();

      // Fetch active monitor job id
      const monitorRes = await db.query<{ active_job_id: string | null }>(
        'SELECT active_job_id FROM cnc_monitor_state WHERE id = 1'
      );
      const activeJobId = monitorRes.rows[0]?.active_job_id || null;

      let whereClauses: string[] = [];
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereClauses.push(`(j.job_id ILIKE $${params.length} OR j.material_code ILIKE $${params.length} OR j.customer_name ILIKE $${params.length} OR j.order_no ILIKE $${params.length})`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM cnc_jobs j ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryParams = [...params, limit, offset];
      const limitOffsetIdx = `$${params.length + 1} OFFSET $${params.length + 2}`;

      const jobsRes = await db.query<{
        job_id: string;
        base_filename: string;
        total_programmed_sheets: number;
        total_layouts: number;
        total_planned_sheets: number;
        total_cut_sheets: number;
        total_pending_sheets: number;
        current_layout_index: number | null;
        sheet_width_mm: string;
        sheet_height_mm: string;
        sheet_thickness_mm: string;
        total_planned_sqm_mm: string;
        total_cut_sqm_mm: string;
        material_code: string;
        material: string | null;
        customer_name: string | null;
        order_no: string | null;
        planned_waste_pct: string | null;
        filename_date: string | null;
        otd_date: string | null;
        fbt_last_write: string | null;
        fbt_file_mtime: string | Date | null;
        last_seen_at: string;
        status: string;
      }>(
        `SELECT *
         FROM cnc_jobs
         ${whereSql}
         ORDER BY last_seen_at DESC
         LIMIT ${limitOffsetIdx}`,
        queryParams
      );

      const files = await Promise.all(
        jobsRes.rows.map(async (j) => {
          // Query file types for this job
          const filesRes = await db.query<{ file_type: string }>(
            'SELECT file_type FROM cnc_job_files WHERE job_id = $1',
            [j.job_id]
          );
          const fileTypes = new Set(filesRes.rows.map(r => r.file_type.toUpperCase()));
          const has_fbt = fileTypes.has('FBT');
          const has_otd = fileTypes.has('OTD');
          const has_cni = fileTypes.has('CNI');
          const has_z01 = fileTypes.has('Z01');
          // Check layouts count and totals
          const layoutsRes = await db.query<{
            layout_index: number;
            qta: number;
            cnt: number;
            dim_x: number;
            dim_y: number;
            thickness_mm: number;
          }>(
            `SELECT layout_index, qta, cnt, dim_x, dim_y, thickness_mm
             FROM cnc_layouts
             WHERE job_id = $1
             ORDER BY layout_index ASC`,
            [j.job_id]
          );

          const layouts = layoutsRes.rows;
          const totalLayouts = layouts.length || j.total_layouts || 0;
          const totalPlannedSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Number(l.qta), 0)
            : (j.total_planned_sheets || j.total_programmed_sheets || 0);
          const totalCutSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Number(l.cnt), 0)
            : (Number(j.total_cut_sheets) || 0);
          const totalPendingSheets = layouts.length > 0
            ? layouts.reduce((sum, l) => sum + Math.max(0, Number(l.qta) - Number(l.cnt)), 0)
            : Math.max(0, totalPlannedSheets - totalCutSheets);

          const nextIncomplete = layouts.find(l => Number(l.cnt) < Number(l.qta));
          const currentLayoutIndex = nextIncomplete?.layout_index ?? j.current_layout_index ?? (totalCutSheets > 0 ? layouts.length : 1);

          const productionSqmMmCut = layouts.length > 0
            ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.cnt)), 0).toFixed(4))
            : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalCutSheets).toFixed(4));

          const productionSqmMmPlanned = layouts.length > 0
            ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.qta)), 0).toFixed(4))
            : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalPlannedSheets).toFixed(4));

          const isCutting = activeJobId === j.job_id;
          let fileStatus: 'CUTTING' | 'COMPLETED' | 'PAUSED' | 'PENDING' = 'PENDING';
          if (isCutting) {
            fileStatus = 'CUTTING';
          } else if (totalPlannedSheets > 0 && totalCutSheets >= totalPlannedSheets) {
            fileStatus = 'COMPLETED';
          } else if (totalCutSheets > 0) {
            fileStatus = 'PAUSED';
          } else {
            fileStatus = 'PENDING';
          }

          const customerNames = (j.customer_name || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          const workOrderNos = (j.order_no || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          return {
            jobId: j.job_id,
            baseFilename: j.base_filename,
            material: j.material || j.material_code,
            materialCode: j.material_code,
            thicknessMm: parseFloat(j.sheet_thickness_mm) || 0,
            widthMm: parseFloat(j.sheet_width_mm) || 0,
            heightMm: parseFloat(j.sheet_height_mm) || 0,
            totalLayouts,
            totalPlannedSheets,
            totalCutSheets,
            totalPendingSheets,
            currentLayoutIndex,
            progressPct: totalPlannedSheets > 0
              ? Math.min(100, Math.round((totalCutSheets / totalPlannedSheets) * 100))
              : 0,
            productionSqmMmPlanned,
            productionSqmMmCut,
            productionSqmMmPending: parseFloat(Math.max(0, productionSqmMmPlanned - productionSqmMmCut).toFixed(4)),
            status: fileStatus,
            isCurrentlyActive: isCutting,
            customersCount: customerNames.length,
            customerNames,
            workOrdersCount: workOrderNos.length,
            workOrderNos,
            plannedWastePct: j.planned_waste_pct ? parseFloat(j.planned_waste_pct) : null,
            filenameDate: j.filename_date,
            otdDate: j.otd_date,
            fbtLastWrite: j.fbt_last_write,
            fbtFileMtime: j.fbt_file_mtime,
            lastSeenAt: j.last_seen_at,
            sourceFiles: {
              fbt: has_fbt,
              otd: has_otd,
              cni: has_cni,
              z01: has_z01,
            },
            hasFbt: has_fbt,
            hasOtd: has_otd,
            hasCni: has_cni,
            hasZ01: has_z01,
          };
        })
      );

      // Filter by status if requested
      const filteredFiles = statusFilter !== 'ALL'
        ? files.filter(f => f.status === statusFilter)
        : files;

      res.json({
        files: filteredFiles,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/cnc/files/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const jobRes = await db.query('SELECT * FROM cnc_jobs WHERE job_id = $1', [jobId]);
      if (jobRes.rows.length === 0) {
        return res.status(404).json({ error: 'CNC File not found' });
      }
      const j = jobRes.rows[0];

      // Layouts
      const layoutsRes = await db.query(
        `SELECT layout_index, layout_code, dim_x, dim_y, thickness_mm, area_sqm, production_sqm_mm, qta, cnt, status
         FROM cnc_layouts
         WHERE job_id = $1
         ORDER BY layout_index ASC`,
        [jobId]
      );

      // Pieces
      const piecesRes = await db.query(
        `SELECT id, sheet_index, piece_id, order_no, wo_no, pos_no, customer_name, width_mm, height_mm, area_sqm, status, completed_at
         FROM cnc_pieces
         WHERE job_id = $1
         ORDER BY sheet_index ASC, id ASC`,
        [jobId]
      );

      // Files
      const filesRes = await db.query(
        `SELECT file_type, filename, file_path, file_size_bytes, file_mtime, content_sha256, last_read_at
         FROM cnc_job_files
         WHERE job_id = $1
         ORDER BY file_type ASC`,
        [jobId]
      );

      // Timeline events
      const timeline = await getJobTimeline(db, jobId);

      const layouts = layoutsRes.rows;
      const totalLayouts = layouts.length || j.total_layouts || 0;
      const totalPlannedSheets = layouts.length > 0
        ? layouts.reduce((sum, l) => sum + Number(l.qta), 0)
        : (j.total_planned_sheets || j.total_programmed_sheets || 0);
      const totalCutSheets = layouts.length > 0
        ? layouts.reduce((sum, l) => sum + Number(l.cnt), 0)
        : (Number(j.total_cut_sheets) || 0);
      const totalPendingSheets = layouts.length > 0
        ? layouts.reduce((sum, l) => sum + Math.max(0, Number(l.qta) - Number(l.cnt)), 0)
        : Math.max(0, totalPlannedSheets - totalCutSheets);

      const productionSqmMmCut = layouts.length > 0
        ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.cnt)), 0).toFixed(4))
        : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalCutSheets).toFixed(4));

      const productionSqmMmPlanned = layouts.length > 0
        ? parseFloat(layouts.reduce((sum, l) => sum + calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.qta)), 0).toFixed(4))
        : parseFloat(calculateProductionSqmMm(Number(j.sheet_width_mm), Number(j.sheet_height_mm), Number(j.sheet_thickness_mm), totalPlannedSheets).toFixed(4));

      // Customer summary
      const customerMap = new Map<string, { customerName: string; piecesCount: number; areaSqm: number; productionSqmMm: number }>();
      for (const p of piecesRes.rows) {
        const cName = p.customer_name?.trim() || 'Unknown Customer';
        const existing = customerMap.get(cName) || { customerName: cName, piecesCount: 0, areaSqm: 0, productionSqmMm: 0 };
        existing.piecesCount += 1;
        const pArea = Number(p.area_sqm) || (Number(p.width_mm || 0) / 1000) * (Number(p.height_mm || 0) / 1000);
        existing.areaSqm += pArea;
        existing.productionSqmMm += pArea * Number(j.sheet_thickness_mm || 0);
        customerMap.set(cName, existing);
      }

      // Work order summary
      const woMap = new Map<string, { workOrderNo: string; customerName: string | null; piecesCount: number; areaSqm: number }>();
      for (const p of piecesRes.rows) {
        const woKey = p.wo_no || p.order_no || 'Unassigned';
        const existing = woMap.get(woKey) || { workOrderNo: woKey, customerName: p.customer_name, piecesCount: 0, areaSqm: 0 };
        existing.piecesCount += 1;
        const pArea = Number(p.area_sqm) || (Number(p.width_mm || 0) / 1000) * (Number(p.height_mm || 0) / 1000);
        existing.areaSqm += pArea;
        woMap.set(woKey, existing);
      }

      res.json({
        job: {
          ...j,
          totalLayouts,
          totalPlannedSheets,
          totalCutSheets,
          totalPendingSheets,
          progressPct: totalPlannedSheets > 0 ? Math.min(100, Math.round((totalCutSheets / totalPlannedSheets) * 100)) : 0,
          productionSqmMmPlanned,
          productionSqmMmCut,
          productionSqmMmPending: parseFloat(Math.max(0, productionSqmMmPlanned - productionSqmMmCut).toFixed(4)),
        },
        layouts: layouts.map(l => ({
          layoutIndex: l.layout_index,
          layoutCode: l.layout_code,
          dimX: Number(l.dim_x),
          dimY: Number(l.dim_y),
          thicknessMm: Number(l.thickness_mm),
          qta: Number(l.qta),
          cnt: Number(l.cnt),
          pending: Math.max(0, Number(l.qta) - Number(l.cnt)),
          status: Number(l.cnt) >= Number(l.qta) ? 'COMPLETED' : (Number(l.cnt) > 0 ? 'IN_PROGRESS' : 'PENDING'),
          productionSqmMm: calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.cnt)),
          productionSqmMmPlanned: calculateProductionSqmMm(Number(l.dim_x), Number(l.dim_y), Number(l.thickness_mm), Number(l.qta)),
        })),
        pieces: piecesRes.rows,
        sourceFiles: filesRes.rows,
        customers: Array.from(customerMap.values()),
        workOrders: Array.from(woMap.values()),
        timeline,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Work Orders with Server-Side Pagination and Aggregation (Issue 1 & 3)
  router.get('/orders', async (req, res) => {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(100, Math.max(10, parseInt((req.query.limit as string) || '50', 10)));
      const offset = (page - 1) * limit;
      const search = ((req.query.search as string) || '').trim();

      let whereClause = '';
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereClause = `WHERE o.work_order_no ILIKE $1 OR o.customer_name ILIKE $1 OR o.order_no ILIKE $1`;
      }

      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM orders o ${whereClause}`,
        params
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryParams = search ? [params[0], limit, offset] : [limit, offset];
      const limitOffsetIdx = search ? '$2 OFFSET $3' : '$1 OFFSET $2';

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
        cut_pieces: string;
        linked_job_id: string | null;
      }>(
        `SELECT
           o.*,
           COALESCE(p.cut_pieces, 0) as cut_pieces,
           p.job_id as linked_job_id
         FROM orders o
         LEFT JOIN (
           SELECT
             COALESCE(wo_no, order_no) as wo_key,
             COUNT(id) as cut_pieces,
             MAX(job_id) as job_id
           FROM cnc_pieces
           WHERE status = 'CUT'
           GROUP BY COALESCE(wo_no, order_no)
         ) p ON p.wo_key = o.work_order_no
         ${whereClause}
         ORDER BY o.id ASC
         LIMIT ${limitOffsetIdx}`,
        queryParams
      );

      const ordersWithProduction = ordersRes.rows.map((o) => {
        const cutPieces = parseInt(o.cut_pieces || '0', 10);
        const requiredPcs = Number(o.total_required_pcs || 0);
        const completionPct = requiredPcs > 0
          ? Math.min(100, Math.round((cutPieces / requiredPcs) * 100))
          : (Number(o.overall_progress_pct) || 0);

        const customers = (o.customer_name || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        return {
          ...o,
          customers,
          work_order_no: o.work_order_no,
          wo_no: o.work_order_no,
          ref_code: o.order_no || '',
          material: '',
          ordered_pcs: requiredPcs,
          producedPieces: cutPieces,
          pendingPieces: Math.max(0, requiredPcs - cutPieces),
          completionPct,
          linkedJobId: o.linked_job_id || null,
        };
      });

      res.json({
        orders: ordersWithProduction,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
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
