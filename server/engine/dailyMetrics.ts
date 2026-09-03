import { IDbClient } from '../db/index.js';

export interface DailyProductionSummary {
  productionDate: string;
  totalMotherSheetsCut: number;
  totalPiecesCut: number;
  totalAreaSqm: number;
  activeJobsCount: number;
  jobBreakdown: {
    jobId: string;
    customerName: string | null;
    orderNo: string | null;
    materialCode: string;
    sheetsCutToday: number;
    piecesCutToday: number;
    areaSqmToday: number;
    totalProgrammedSheets: number;
    lifetimeCompletedSheets: number;
  }[];
  events: {
    eventId: number;
    jobId: string;
    sheetIndex: number;
    piecesCount: number;
    areaSqm: number;
    eventTimestamp: string;
    confidence: string;
    fbtLastWrite: string | null;
  }[];
}

export async function getDailyProduction(
  db: IDbClient,
  dateStr?: string
): Promise<DailyProductionSummary> {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];

  // 1. Mother Sheets Cut, Pieces Cut, Area
  const summaryRes = await db.query<{
    sheets_count: string;
    pieces_count: string;
    total_area: string;
    distinct_jobs: string;
  }>(
    `SELECT
       COUNT(DISTINCT CONCAT(job_id, '-', sheet_index)) as sheets_count,
       COALESCE(SUM(pieces_count), 0) as pieces_count,
       COALESCE(SUM(area_sqm), 0) as total_area,
       COUNT(DISTINCT job_id) as distinct_jobs
     FROM production_events
     WHERE production_date = $1 AND event_type = 'SHEET_COMPLETED'`,
    [targetDate]
  );

  const row = summaryRes.rows[0];
  const totalMotherSheetsCut = parseInt(row?.sheets_count || '0', 10);
  const totalPiecesCut = parseInt(row?.pieces_count || '0', 10);
  const totalAreaSqm = parseFloat(parseFloat(row?.total_area || '0').toFixed(4));
  const activeJobsCount = parseInt(row?.distinct_jobs || '0', 10);

  // 2. Breakdown by Job
  const breakdownRes = await db.query<{
    job_id: string;
    customer_name: string | null;
    order_no: string | null;
    material_code: string;
    sheets_today: string;
    pieces_today: string;
    area_today: string;
    total_programmed_sheets: number;
  }>(
    `SELECT
       j.job_id,
       j.customer_name,
       j.order_no,
       j.material_code,
       j.total_programmed_sheets,
       COUNT(pe.sheet_index) as sheets_today,
       COALESCE(SUM(pe.pieces_count), 0) as pieces_today,
       COALESCE(SUM(pe.area_sqm), 0) as area_today
     FROM production_events pe
     JOIN cnc_jobs j ON pe.job_id = j.job_id
     WHERE pe.production_date = $1 AND pe.event_type = 'SHEET_COMPLETED'
     GROUP BY j.job_id, j.customer_name, j.order_no, j.material_code, j.total_programmed_sheets
     ORDER BY j.job_id`,
    [targetDate]
  );

  const jobBreakdown = await Promise.all(
    breakdownRes.rows.map(async (r) => {
      // Fetch lifetime completed sheets for this job
      const lifetimeRes = await db.query<{ lifetime_count: string }>(
        `SELECT COUNT(DISTINCT sheet_index) as lifetime_count
         FROM production_events
         WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'`,
        [r.job_id]
      );
      const lifetimeCompletedSheets = parseInt(lifetimeRes.rows[0]?.lifetime_count || '0', 10);

      return {
        jobId: r.job_id,
        customerName: r.customer_name,
        orderNo: r.order_no,
        materialCode: r.material_code,
        sheetsCutToday: parseInt(r.sheets_today, 10),
        piecesCutToday: parseInt(r.pieces_today, 10),
        areaSqmToday: parseFloat(parseFloat(r.area_today).toFixed(4)),
        totalProgrammedSheets: r.total_programmed_sheets,
        lifetimeCompletedSheets,
      };
    })
  );

  // 3. Events list for the day
  const eventsRes = await db.query<{
    event_id: number;
    job_id: string;
    sheet_index: number;
    pieces_count: number;
    area_sqm: string;
    event_timestamp: string;
    confidence: string;
    fbt_last_write: string | null;
  }>(
    `SELECT
       event_id, job_id, sheet_index, pieces_count, area_sqm,
       event_timestamp, confidence, fbt_last_write
     FROM production_events
     WHERE production_date = $1 AND event_type = 'SHEET_COMPLETED'
     ORDER BY event_timestamp DESC`,
    [targetDate]
  );

  const events = eventsRes.rows.map(e => ({
    eventId: e.event_id,
    jobId: e.job_id,
    sheetIndex: e.sheet_index,
    piecesCount: e.pieces_count,
    areaSqm: parseFloat(parseFloat(e.area_sqm).toFixed(4)),
    eventTimestamp: e.event_timestamp,
    confidence: e.confidence,
    fbtLastWrite: e.fbt_last_write,
  }));

  return {
    productionDate: targetDate,
    totalMotherSheetsCut,
    totalPiecesCut,
    totalAreaSqm,
    activeJobsCount,
    jobBreakdown,
    events,
  };
}

export async function getJobTimeline(db: IDbClient, jobId: string) {
  const eventsRes = await db.query<{
    event_id: number;
    sheet_index: number;
    event_timestamp: string;
    production_date: string;
    pieces_count: number;
    area_sqm: string;
    fbt_last_write: string | null;
  }>(
    `SELECT
       event_id, sheet_index, event_timestamp, production_date,
       pieces_count, area_sqm, fbt_last_write
     FROM production_events
     WHERE job_id = $1 AND event_type = 'SHEET_COMPLETED'
     ORDER BY sheet_index ASC, event_timestamp ASC`,
    [jobId]
  );

  return eventsRes.rows.map(r => ({
    eventId: r.event_id,
    sheetIndex: r.sheet_index,
    eventTimestamp: r.event_timestamp,
    productionDate: r.production_date,
    piecesCount: r.pieces_count,
    areaSqm: parseFloat(parseFloat(r.area_sqm).toFixed(4)),
    fbtLastWrite: r.fbt_last_write,
  }));
}
