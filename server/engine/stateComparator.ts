import { IDbClient } from '../db/index.js';
import { CorrelatedCncJob, FbtSheetRecord } from '../parsers/types.js';

export interface TransitionResult {
  jobId: string;
  isNewJob: boolean;
  previousCompletedCount: number;
  newCompletedCount: number;
  newEventsCreated: number;
  newCompletedSheetIndices: number[];
  wasResumed: boolean;
  totalPlannedSheets: number;
  totalCutSheets: number;
  totalPendingSheets: number;
  currentLayoutIndex: number | null;
}

export async function processJobStateTransition(
  db: IDbClient,
  job: CorrelatedCncJob,
  scanTime: Date = new Date(),
  overrideDateStr?: string // Allows testing specific calendar days (e.g. '2026-09-01')
): Promise<TransitionResult> {
  // Authoritative production date logic:
  // If overrideDateStr provided (e.g. test fixture), use it.
  // Otherwise use the job's authoritative effectiveCuttingDate (FBT [LAST_WRITE] or file mtime).
  // NEVER use today's scan time as historical production date.
  let effectiveEventTime: Date;
  if (overrideDateStr) {
    effectiveEventTime = scanTime;
  } else if (job.effectiveCuttingDate instanceof Date) {
    effectiveEventTime = job.effectiveCuttingDate;
  } else if (typeof job.effectiveCuttingDate === 'string' || typeof job.effectiveCuttingDate === 'number') {
    effectiveEventTime = new Date(job.effectiveCuttingDate);
  } else {
    effectiveEventTime = scanTime;
  }
  const effectiveDateStr = overrideDateStr || job.effectiveCuttingDateStr || effectiveEventTime.toISOString().split('T')[0];

  const resolvedCustomerName = job.customerName || (job.customerNames && job.customerNames.length > 0 ? job.customerNames.join(', ') : null);

  // 1. Calculate confirmed FBT totals across all layouts
  // Confirmed FBT business logic:
  // - Total layouts = job.sheets.length
  // - Planned raw sheets = SUM(Qta)
  // - Actual raw sheets cut = SUM(Cnt)
  // - Pending raw sheets = SUM(Math.max(0, Qta - Cnt))
  const totalLayouts = job.sheets.length;
  const totalPlannedSheets = job.sheets.reduce((sum, s) => sum + (s.quantityProgrammed ?? 1), 0);
  const totalCutSheets = job.sheets.reduce(
    (sum, s) => sum + (s.quantityCut ?? (s.isCompleted ? (s.quantityProgrammed ?? 1) : 0)),
    0
  );
  const totalPendingSheets = job.sheets.reduce(
    (sum, s) => {
      const qta = s.quantityProgrammed ?? 1;
      const cnt = s.quantityCut ?? (s.isCompleted ? qta : 0);
      return sum + Math.max(0, qta - cnt);
    },
    0
  );
  const isNowComplete = totalPlannedSheets > 0 && totalCutSheets >= totalPlannedSheets;

  // Determine current active layout:
  // "The logical next incomplete layout is the first layout where Cnt < Qta"
  const nextIncompleteLayout = job.sheets.find(s => {
    const qta = s.quantityProgrammed ?? 1;
    const cnt = s.quantityCut ?? (s.isCompleted ? qta : 0);
    return cnt < qta;
  });
  const currentLayoutIndex = nextIncompleteLayout
    ? (nextIncompleteLayout.layoutIndex ?? nextIncompleteLayout.sheetIndex ?? 1)
    : (job.sheets.length > 0 ? (job.sheets[job.sheets.length - 1].layoutIndex ?? job.sheets[job.sheets.length - 1].sheetIndex ?? 1) : null);

  // 2. Check if job exists in PostgreSQL
  const existingJobRes = await db.query<{
    job_id: string;
    total_programmed_sheets: number;
    status: string;
    customer_name: string | null;
  }>(
    'SELECT job_id, total_programmed_sheets, status, customer_name FROM cnc_jobs WHERE job_id = $1',
    [job.jobId]
  );

  const isNewJob = existingJobRes.rows.length === 0;

  if (isNewJob) {
    // Create new job record
    await db.query(
      `INSERT INTO cnc_jobs (
        job_id, base_filename, total_programmed_sheets, total_layouts, total_planned_sheets,
        total_cut_sheets, total_pending_sheets, current_layout_index, sheet_width_mm, sheet_height_mm,
        sheet_thickness_mm, material_code, customer_name, order_no, planned_waste_pct,
        filename_date, otd_date, fbt_last_write, first_detected_at, last_seen_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19, $20)`,
      [
        job.jobId,
        job.baseFilename,
        totalPlannedSheets,
        totalLayouts,
        totalPlannedSheets,
        totalCutSheets,
        totalPendingSheets,
        currentLayoutIndex,
        job.sheetWidthMm,
        job.sheetHeightMm,
        job.sheetThicknessMm,
        job.materialCode,
        resolvedCustomerName || null,
        job.orderNo || null,
        job.plannedWastePct ?? null,
        job.filenameDate || null,
        job.otdDate || null,
        job.fbtLastWrite || null,
        scanTime.toISOString(),
        isNowComplete ? 'COMPLETED' : 'ACTIVE',
      ]
    );

    // Populate pieces table if OTD pieces exist
    if (job.pieces && job.pieces.length > 0) {
      for (const piece of job.pieces) {
        let pieceSheetIdx = 1;
        if (piece.sheetCode) {
          const match = piece.sheetCode.match(/(\d+)$/);
          if (match) pieceSheetIdx = parseInt(match[1], 10);
        }
        await db.query(
          `INSERT INTO cnc_pieces (
            job_id, sheet_index, piece_id, order_no, wo_no, pos_no, customer_name,
            width_mm, height_mm, area_sqm, rack_no, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')`,
          [
            job.jobId,
            pieceSheetIdx,
            piece.id || null,
            piece.orderNo || null,
            piece.orderNo || null,
            piece.posNo || null,
            piece.customer || job.customerName || null,
            piece.sheetWidth || null,
            piece.sheetHeight || null,
            piece.areaSqm || null,
            piece.rackNo || null,
          ]
        );
      }
    }

    await db.query(
      `INSERT INTO system_events (event_type, job_id, message, created_at)
       VALUES ('JOB_CREATED', $1, $2, $3)`,
      [job.jobId, `New CNC Job detected: ${job.jobId} (${totalPlannedSheets} planned sheets, ${totalLayouts} layouts)`, scanTime.toISOString()]
    );
  } else {
    // If existing job has new customer information or updated last write, update it
    if (resolvedCustomerName && existingJobRes.rows[0]?.customer_name !== resolvedCustomerName) {
      await db.query(
        `UPDATE cnc_jobs
         SET customer_name = COALESCE($1, customer_name),
             order_no = COALESCE($2, order_no)
         WHERE job_id = $3`,
        [resolvedCustomerName, job.orderNo || null, job.jobId]
      );
    }
  }

  // 3. Load previously persisted layout states from PostgreSQL (SURVIVES SERVER RESTARTS)
  // Check cnc_layouts first; fallback to cnc_mother_sheets if cnc_layouts is empty for this job
  const persistedLayoutsRes = await db.query<{
    layout_index: number;
    qta: number;
    cnt: number;
    status: string;
  }>(
    `SELECT layout_index, qta, cnt, status
     FROM cnc_layouts
     WHERE job_id = $1
     ORDER BY layout_index ASC`,
    [job.jobId]
  );

  const previousLayoutMap = new Map<number, { qta: number; cnt: number; status: string }>();
  for (const row of persistedLayoutsRes.rows) {
    previousLayoutMap.set(row.layout_index, {
      qta: row.qta,
      cnt: row.cnt,
      status: row.status,
    });
  }

  // If cnc_layouts was empty, check cnc_mother_sheets
  if (previousLayoutMap.size === 0) {
    const fallbackRes = await db.query<{
      sheet_index: number;
      qta: number;
      cnt: number;
      status: string;
    }>(
      `SELECT sheet_index, COALESCE(qta, 1) as qta, COALESCE(cnt, 0) as cnt, status
       FROM cnc_mother_sheets
       WHERE job_id = $1
       ORDER BY sheet_index ASC`,
      [job.jobId]
    );
    for (const row of fallbackRes.rows) {
      previousLayoutMap.set(row.sheet_index, {
        qta: row.qta,
        cnt: row.cnt,
        status: row.status,
      });
    }
  }

  // Fetch already recorded completed events from production_events
  const existingEventsRes = await db.query<{ sheet_index: number }>(
    "SELECT sheet_index FROM production_events WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'",
    [job.jobId]
  );
  const alreadyRecordedSheetIndices = new Set(existingEventsRes.rows.map(r => r.sheet_index));
  const previousCompletedCount = alreadyRecordedSheetIndices.size;

  // 4. Compare previous state against new state PER LAYOUT
  // Sort layouts by layoutIndex (or original sequence in FBT)
  const sortedSheets = [...job.sheets].sort(
    (a, b) => (a.layoutIndex ?? a.sheetIndex ?? 0) - (b.layoutIndex ?? b.sheetIndex ?? 0)
  );

  // Precalculate cumulative sheet offsets for each layout:
  // Layout 1 starts at offset 0.
  // Layout k starts at offset = SUM(Qta of all layouts before k).
  // For cut copy c (1 <= c <= Qta_k), the unique raw sheet index is offset + c.
  const layoutStartOffsets = new Map<number, number>();
  let runningOffset = 0;
  for (const s of sortedSheets) {
    const idx = s.layoutIndex ?? s.sheetIndex ?? 1;
    layoutStartOffsets.set(idx, runningOffset);
    runningOffset += (s.quantityProgrammed || 1);
  }

  const newlyCompletedSheetIndices: number[] = [];
  let eventsCreated = 0;

  // Check previous active job
  const monitorStateRes = await db.query<{ active_job_id: string | null }>(
    'SELECT active_job_id FROM cnc_monitor_state WHERE id = 1'
  );
  const previousActiveJob = monitorStateRes.rows[0]?.active_job_id;
  let wasResumed = false;

  for (const sheet of sortedSheets) {
    const layoutIdx = sheet.layoutIndex ?? sheet.sheetIndex ?? 1;
    const newQta = sheet.quantityProgrammed ?? 1;
    const newCnt = sheet.quantityCut ?? (sheet.isCompleted ? newQta : 0);
    const prev = previousLayoutMap.get(layoutIdx);

    const prevCnt = prev ? prev.cnt : 0;
    const newlyCompleted = newCnt - prevCnt;

    const startOffset = layoutStartOffsets.get(layoutIdx) ?? 0;
    const areaSqm = (sheet.dimX / 1000) * (sheet.dimY / 1000);

    // If Cnt increased (newly_completed > 0): create events for each newly completed cut copy
    if (newlyCompleted > 0) {
      for (let c = prevCnt + 1; c <= newCnt; c++) {
        const rawSheetIndex = startOffset + c;

        if (!alreadyRecordedSheetIndices.has(rawSheetIndex)) {
          newlyCompletedSheetIndices.push(rawSheetIndex);

          // Check piece count for this sheet / layout
          const pieceCountRes = await db.query<{ count: string }>(
            'SELECT COUNT(*) as count FROM cnc_pieces WHERE job_id = $1 AND sheet_index = $2',
            [job.jobId, layoutIdx]
          );
          let piecesForSheet = parseInt(pieceCountRes.rows[0]?.count || '0', 10);
          if (piecesForSheet === 0 && job.pieces.length > 0) {
            piecesForSheet = Math.max(1, Math.round(job.pieces.length / Math.max(1, totalPlannedSheets)));
          } else if (piecesForSheet === 0) {
            piecesForSheet = 1;
          }

          // INSERT IMMUTABLE PRODUCTION EVENT (Idempotent: ON CONFLICT DO NOTHING)
          const insertEventRes = await db.query(
            `INSERT INTO production_events (
              job_id, sheet_index, event_type, event_timestamp, production_date,
              pieces_count, area_sqm, fbt_raw_line, fbt_last_write, confidence,
              layout_index, layout_cut_index, created_at
            ) VALUES ($1, $2, 'SHEET_COMPLETED', $3, $4, $5, $6, $7, $8, 'INFERRED', $9, $10, $11)
            ON CONFLICT (job_id, sheet_index, event_type) DO NOTHING
            RETURNING event_id`,
            [
              job.jobId,
              rawSheetIndex,
              effectiveEventTime.toISOString(),
              effectiveDateStr,
              piecesForSheet,
              areaSqm,
              sheet.rawLine,
              job.fbtLastWrite || null,
              layoutIdx,
              c,
              scanTime.toISOString(),
            ]
          );

          if (insertEventRes.rows.length > 0) {
            eventsCreated++;
            alreadyRecordedSheetIndices.add(rawSheetIndex);
          }
        }
      }
    }

    // 5. Update layout state in PostgreSQL (cnc_layouts & cnc_mother_sheets)
    const layoutStatus = newCnt >= newQta ? 'COMPLETED' : (newCnt > 0 ? 'IN_PROGRESS' : 'PENDING');
    const isCompleted = newCnt >= newQta;

    await db.query(
      `INSERT INTO cnc_layouts (
        job_id, layout_index, layout_code, dim_x, dim_y, thickness_mm, area_sqm,
        qta, cnt, raw_line, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (job_id, layout_index) DO UPDATE
      SET qta = EXCLUDED.qta,
          cnt = EXCLUDED.cnt,
          dim_x = EXCLUDED.dim_x,
          dim_y = EXCLUDED.dim_y,
          thickness_mm = EXCLUDED.thickness_mm,
          area_sqm = EXCLUDED.area_sqm,
          raw_line = EXCLUDED.raw_line,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at`,
      [
        job.jobId,
        layoutIdx,
        sheet.sheetCode || `${job.jobId}-----${layoutIdx}`,
        sheet.dimX,
        sheet.dimY,
        sheet.thickness,
        areaSqm,
        newQta,
        newCnt,
        sheet.rawLine,
        layoutStatus,
        scanTime.toISOString(),
      ]
    );

    // Also update cnc_mother_sheets for backwards-compatibility
    await db.query(
      `INSERT INTO cnc_mother_sheets (
        job_id, sheet_index, layout_index, sheet_code, width_mm, height_mm, thickness_mm,
        area_sqm, programmed_pieces, qta, cnt, fbt_record_raw, status, is_completed, completed_at
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (job_id, sheet_index) DO UPDATE
      SET qta = EXCLUDED.qta,
          cnt = EXCLUDED.cnt,
          status = EXCLUDED.status,
          is_completed = EXCLUDED.is_completed,
          fbt_record_raw = EXCLUDED.fbt_record_raw,
          completed_at = CASE WHEN EXCLUDED.is_completed THEN COALESCE(cnc_mother_sheets.completed_at, EXCLUDED.completed_at) ELSE NULL END`,
      [
        job.jobId,
        layoutIdx,
        sheet.sheetCode || `${job.jobId}-----${layoutIdx}`,
        sheet.dimX,
        sheet.dimY,
        sheet.thickness,
        areaSqm,
        newQta,
        newQta,
        newCnt,
        sheet.rawLine,
        layoutStatus,
        isCompleted,
        isCompleted ? effectiveEventTime.toISOString() : null,
      ]
    );
  }

  // Check if job was resumed after another job ran
  if (eventsCreated > 0) {
    if (previousActiveJob && previousActiveJob !== job.jobId) {
      wasResumed = true;
      await db.query(
        `INSERT INTO system_events (event_type, job_id, message, created_at)
         VALUES ('JOB_RESUMED', $1, $2, $3)`,
        [
          job.jobId,
          `Job ${job.jobId} resumed after ${previousActiveJob}. Newly completed raw sheets: [${newlyCompletedSheetIndices.join(', ')}]`,
          scanTime.toISOString(),
        ]
      );
    }

    // Update active job in monitor state with the current active layout
    await db.query(
      `UPDATE cnc_monitor_state
       SET active_job_id = $1, current_sheet_index = $2, last_scan_at = $3
       WHERE id = 1`,
      [job.jobId, currentLayoutIndex, scanTime.toISOString()]
    );
  }

  // 6. Update job status, aggregate counts, and timestamp in cnc_jobs
  const newTotalCompleted = previousCompletedCount + eventsCreated;

  await db.query(
    `UPDATE cnc_jobs
     SET total_programmed_sheets = $1,
         total_layouts = $2,
         total_planned_sheets = $1,
         total_cut_sheets = $3,
         total_pending_sheets = $4,
         current_layout_index = $5,
         last_seen_at = $6,
         status = $7,
         fbt_last_write = COALESCE($8, fbt_last_write)
     WHERE job_id = $9`,
    [
      totalPlannedSheets,
      totalLayouts,
      totalCutSheets,
      totalPendingSheets,
      currentLayoutIndex,
      scanTime.toISOString(),
      isNowComplete ? 'COMPLETED' : 'ACTIVE',
      job.fbtLastWrite || null,
      job.jobId,
    ]
  );

  return {
    jobId: job.jobId,
    isNewJob,
    previousCompletedCount,
    newCompletedCount: newTotalCompleted,
    newEventsCreated: eventsCreated,
    newCompletedSheetIndices: newlyCompletedSheetIndices,
    wasResumed,
    totalPlannedSheets,
    totalCutSheets,
    totalPendingSheets,
    currentLayoutIndex,
  };
}
