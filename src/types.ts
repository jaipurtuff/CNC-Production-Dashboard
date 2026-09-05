export interface CncStatus {
  isOnline: boolean;
  sharePath: string;
  lastReachableAt: string | null;
  lastScanAt: string | null;
  activeJobId: string | null;
  currentSheetIndex: number | null;
  totalJobsTracked: number;
  errorMessage: string | null;
  activeJob: {
    job_id: string;
    base_filename: string;
    total_programmed_sheets: number;
    total_layouts?: number;
    total_planned_sheets?: number;
    total_cut_sheets?: number;
    total_pending_sheets?: number;
    current_layout_index?: number | null;
    current_layout?: {
      layoutIndex: number;
      layoutCode: string;
      qta: number;
      cnt: number;
      dimX: number;
      dimY: number;
      thickness: number;
      isCompleted: boolean;
    } | null;
    layouts?: {
      layoutIndex: number;
      layoutCode: string;
      qta: number;
      cnt: number;
      isCompleted: boolean;
    }[];
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
    completedSheets: number;
    progressPct: number;
    last_seen_at: string;
  } | null;
}

export interface OrderSyncStatus {
  id: number;
  status: string;
  last_sync_time: string | null;
  rows_processed: number;
  new_rows: number;
  changed_rows: number;
  unchanged_rows: number;
  error_message: string | null;
}

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

export interface CncJobItem {
  job_id: string;
  base_filename: string;
  total_programmed_sheets: number;
  sheet_width_mm: number;
  sheet_height_mm: number;
  sheet_thickness_mm: number;
  material_code: string;
  customer_name: string | null;
  order_no: string | null;
  planned_waste_pct: number | null;
  filename_date: string | null;
  otd_date: string | null;
  fbt_last_write: string | null;
  first_detected_at: string;
  last_seen_at: string;
  status: string;
  completedSheets: number;
  progressPct: number;
}

export interface WorkOrderItem {
  id?: number;
  customer_id?: string | null;
  order_no?: string | null;
  work_order_no: string;
  wo_no?: string;
  ref_code?: string;
  customer_name: string;
  material?: string;
  ordered_pcs?: number;
  total_required_pcs?: number;
  total_cut_pcs?: number;
  total_pending_pcs?: number;
  overall_progress_pct?: number;
  source_row?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  first_synced_at?: string;
  last_synced_at?: string;
  sync_status?: string;
  producedPieces: number;
  pendingPieces: number;
  completionPct: number;
  linkedJobId: string | null;
}

export interface TraceabilityRecord {
  piece_id: string;
  order_no: string;
  pos_no: string;
  customer_name: string;
  sheet_index: number;
  piece_width: number;
  piece_height: number;
  piece_area: number;
  piece_status: string;
  piece_completed_at: string | null;
  job_id: string;
  base_filename: string;
  material_code: string;
  mother_width: number;
  mother_height: number;
  mother_area: number;
  event_id: number;
  event_timestamp: string;
  production_date: string;
  confidence: string;
}

export interface TestResultItem {
  testName: string;
  passed: boolean;
  durationMs: number;
  message: string;
}
