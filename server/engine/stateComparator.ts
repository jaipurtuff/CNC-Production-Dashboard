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
}

export async function processJobStateTransition(
  db: IDbClient,
  job: CorrelatedCncJob,
  effectiveTime: Date = new Date(),
  overrideDateStr?: string // Allows testing specific calendar days (e.g. '2026-09-01')
): Promise<TransitionResult> {
  const effectiveDateStr = overrideDateStr || effectiveTime.toISOString().split('T')[0];

  // 1. Check if job exists
  const existingJobRes = await db.query<{
    job_id: string;
    total_programmed_sheets: number;
    status: string;
  }>(
    'SELECT job_id, total_programmed_sheets, status FROM cnc_jobs WHERE job_id = $1',
    [job.jobId]
  );

  const isNewJob = existingJobRes.rows.length === 0;

  if (isNewJob) {
    // Create new job record
    await db.query(
      `INSERT INTO cnc_jobs (
        job_id, base_filename, total_programmed_sheets, sheet_width_mm, sheet_height_mm,
        sheet_thickness_mm, material_code, customer_name, order_no, planned_waste_pct,
        filename_date, otd_date, fbt_last_write, first_detected_at, last_seen_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15)`,
      [
        job.jobId,
        job.baseFilename,
        job.totalProgrammedSheets,
        job.sheetWidthMm,
        job.sheetHeightMm,
        job.sheetThicknessMm,
        job.materialCode,
        job.customerName || null,
        job.orderNo || null,
        job.plannedWastePct ?? null,
        job.filenameDate || null,
        job.otdDate || null,
        job.fbtLastWrite || null,
        effectiveTime.toISOString(),
        job.isComplete ? 'COMPLETED' : 'ACTIVE',
      ]
    );

    // Populate mother sheets table
    for (const sheet of job.sheets) {
      const areaSqm = (sheet.dimX / 1000) * (sheet.dimY / 1000);
      await db.query(
        `INSERT INTO cnc_mother_sheets (
          job_id, sheet_index, sheet_code, width_mm, height_mm, thickness_mm,
          area_sqm, programmed_pieces, fbt_record_raw, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
        ON CONFLICT (job_id, sheet_index) DO NOTHING`,
        [
          job.jobId,
          sheet.sheetIndex,
          sheet.sheetCode,
          sheet.dimX,
          sheet.dimY,
          sheet.thickness,
          areaSqm,
          sheet.quantityProgrammed,
          sheet.rawLine,
        ]
      );
    }

    // Populate pieces table if OTD pieces exist
    if (job.pieces && job.pieces.length > 0) {
      for (const piece of job.pieces) {
        // Find sheet index by sheet code or default to 1
        let pieceSheetIdx = 1;
        if (piece.sheetCode) {
          const match = piece.sheetCode.match(/(\d+)$/);
          if (match) pieceSheetIdx = parseInt(match[1], 10);
        }
        await db.query(
          `INSERT INTO cnc_pieces (
            job_id, sheet_index, piece_id, order_no, pos_no, customer_name,
            width_mm, height_mm, area_sqm, rack_no, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING')`,
          [
            job.jobId,
            pieceSheetIdx,
            piece.id || null,
            piece.orderNo || null,
            piece.posNo || null,
            piece.customer || null,
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
      [job.jobId, `New CNC Job detected: ${job.jobId} (${job.totalProgrammedSheets} sheets)`, effectiveTime.toISOString()]
    );
  }

  // 2. Fetch existing completed sheets for this job
  const existingEventsRes = await db.query<{ sheet_index: number }>(
    "SELECT sheet_index FROM production_events WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'",
    [job.jobId]
  );
  const alreadyCompletedIndices = new Set(existingEventsRes.rows.map(r => r.sheet_index));
  const previousCompletedCount = alreadyCompletedIndices.size;

  // 3. Compare with current FBT sheet states
  const newlyCompletedIndices: number[] = [];
  let eventsCreated = 0;

  // Check which active job was running previously
  const monitorStateRes = await db.query<{ active_job_id: string | null }>(
    'SELECT active_job_id FROM cnc_monitor_state WHERE id = 1'
  );
  const previousActiveJob = monitorStateRes.rows[0]?.active_job_id;
  let wasResumed = false;

  for (const sheet of job.sheets) {
    if (sheet.isCompleted && !alreadyCompletedIndices.has(sheet.sheetIndex)) {
      // New completion event!
      newlyCompletedIndices.push(sheet.sheetIndex);

      // Check piece count for this sheet
      const pieceCountRes = await db.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM cnc_pieces WHERE job_id = $1 AND sheet_index = $2',
        [job.jobId, sheet.sheetIndex]
      );
      let piecesForSheet = parseInt(pieceCountRes.rows[0]?.count || '0', 10);
      if (piecesForSheet === 0 && job.pieces.length > 0) {
        // If pieces are not explicitly per-sheet, distribute or use total piece count / total sheets
        piecesForSheet = Math.max(1, Math.round(job.pieces.length / Math.max(1, job.totalProgrammedSheets)));
      } else if (piecesForSheet === 0) {
        piecesForSheet = 1;
      }

      const areaSqm = (sheet.dimX / 1000) * (sheet.dimY / 1000);

      // INSERT IMMUTABLE PRODUCTION EVENT (Idempotent: ON CONFLICT DO NOTHING)
      const insertEventRes = await db.query(
        `INSERT INTO production_events (
          job_id, sheet_index, event_type, event_timestamp, production_date,
          pieces_count, area_sqm, fbt_raw_line, fbt_last_write, confidence, created_at
        ) VALUES ($1, $2, 'SHEET_COMPLETED', $3, $4, $5, $6, $7, $8, 'INFERRED', $3)
        ON CONFLICT (job_id, sheet_index, event_type) DO NOTHING
        RETURNING event_id`,
        [
          job.jobId,
          sheet.sheetIndex,
          effectiveTime.toISOString(),
          effectiveDateStr,
          piecesForSheet,
          areaSqm,
          sheet.rawLine,
          job.fbtLastWrite || null,
        ]
      );

      if (insertEventRes.rows.length > 0) {
        eventsCreated++;

        // Update mother sheet status
        await db.query(
          `UPDATE cnc_mother_sheets
           SET status = 'COMPLETED', completed_at = $1
           WHERE job_id = $2 AND sheet_index = $3`,
          [effectiveTime.toISOString(), job.jobId, sheet.sheetIndex]
        );

        // Update pieces status
        await db.query(
          `UPDATE cnc_pieces
           SET status = 'CUT', completed_at = $1
           WHERE job_id = $2 AND sheet_index = $3`,
          [effectiveTime.toISOString(), job.jobId, sheet.sheetIndex]
        );
      }
    }
  }

  // Check if job was resumed after another job ran or after previous inactivity
  if (eventsCreated > 0) {
    if (previousActiveJob && previousActiveJob !== job.jobId) {
      wasResumed = true;
      await db.query(
        `INSERT INTO system_events (event_type, job_id, message, created_at)
         VALUES ('JOB_RESUMED', $1, $2, $3)`,
        [
          job.jobId,
          `Job ${job.jobId} resumed after ${previousActiveJob}. Newly completed sheets: [${newlyCompletedIndices.join(', ')}]`,
          effectiveTime.toISOString(),
        ]
      );
    }

    // Update active job in monitor state
    const latestSheet = newlyCompletedIndices[newlyCompletedIndices.length - 1];
    await db.query(
      `UPDATE cnc_monitor_state
       SET active_job_id = $1, current_sheet_index = $2, last_scan_at = $3
       WHERE id = 1`,
      [job.jobId, latestSheet, effectiveTime.toISOString()]
    );
  }

  // 4. Update job status & timestamp
  const newTotalCompleted = previousCompletedCount + eventsCreated;
  const isNowComplete = job.totalProgrammedSheets > 0 && newTotalCompleted >= job.totalProgrammedSheets;

  await db.query(
    `UPDATE cnc_jobs
     SET last_seen_at = $1,
         status = $2,
         fbt_last_write = COALESCE($3, fbt_last_write)
     WHERE job_id = $4`,
    [
      effectiveTime.toISOString(),
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
    newCompletedSheetIndices: newlyCompletedIndices,
    wasResumed,
  };
}
