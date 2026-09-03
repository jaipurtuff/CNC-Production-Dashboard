import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { IDbClient } from '../db/index.js';

export interface RawOrderRow {
  sourceRow: number;
  refCode: string;
  woNo: string;
  customerName: string;
  material: string;
  orderedPcs: number;
  rowSha256: string;
}

export class GoogleSheetSyncService {
  private db: IDbClient;
  private sheetId: string | undefined;
  private range: string;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;

  constructor(
    db: IDbClient,
    sheetId?: string,
    range?: string,
    intervalMs: number = parseInt(process.env.GOOGLE_SHEET_SYNC_INTERVAL_MS || '300000', 10)
  ) {
    this.db = db;
    this.sheetId = sheetId || process.env.GOOGLE_SHEET_ID;
    this.range = range || process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:E';
    this.intervalMs = intervalMs;
  }

  public start() {
    if (this.timer) return;
    console.log(`[Google Sheets API] Starting automatic background order sync (every ${Math.round(this.intervalMs / 1000 / 60)} minutes)`);

    // Immediate initial sync
    this.performSync().catch(err => console.error('[Google Sheets API] Error in initial sync:', err));

    // Background recurring sync
    this.timer = setInterval(() => {
      this.performSync().catch(err => console.error('[Google Sheets API] Error in scheduled sync:', err));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Google Sheets API] Stopped background sync service');
    }
  }

  public setSheetId(newSheetId: string) {
    this.sheetId = newSheetId;
  }

  public getSheetId(): string | undefined {
    return this.sheetId;
  }

  public async performSync(): Promise<{
    newRows: number;
    changedRows: number;
    unchangedRows: number;
    totalRows: number;
  }> {
    if (this.isSyncing) {
      return { newRows: 0, changedRows: 0, unchangedRows: 0, totalRows: 0 };
    }
    this.isSyncing = true;

    try {
      // Check if credentials and sheetId are configured
      const authResult = this.resolveGoogleAuth();
      if (!authResult || authResult.isPlaceholder || !authResult.auth || !this.sheetId) {
        const missing = [];
        if (!this.sheetId) missing.push('GOOGLE_SHEET_ID');
        if (!authResult?.auth || authResult?.isPlaceholder) missing.push('GOOGLE_APPLICATION_CREDENTIALS');
        
        await this.db.query(
          `UPDATE order_sync_state
           SET status = 'AWAITING_CONFIG',
               error_message = $1
           WHERE id = 1`,
          [`Awaiting configuration: provide ${missing.join(' and ')} in .env to sync live Google Sheets order master.`]
        );
        return { newRows: 0, changedRows: 0, unchangedRows: 0, totalRows: 0 };
      }

      await this.db.query("UPDATE order_sync_state SET status = 'SYNCING' WHERE id = 1");

      const sheets = google.sheets({ version: 'v4', auth: authResult.auth });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: this.range,
      });

      const rawValues = response.data.values || [];
      const parsedRows = this.parseSheetValues(rawValues);

      let newCount = 0;
      let changedCount = 0;
      let unchangedCount = 0;

      for (const row of parsedRows) {
        // Check existing row by WO No.
        const existingRes = await this.db.query<{
          wo_no: string;
          row_sha256: string;
        }>(
          'SELECT wo_no, row_sha256 FROM orders WHERE wo_no = $1',
          [row.woNo]
        );

        if (existingRes.rows.length === 0) {
          // NEW row
          newCount++;
          await this.db.query(
            `INSERT INTO orders (
              wo_no, ref_code, customer_name, material, ordered_pcs,
              source_row, row_sha256, first_synced_at, last_synced_at, sync_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'NEW')`,
            [
              row.woNo,
              row.refCode,
              row.customerName,
              row.material,
              row.orderedPcs,
              row.sourceRow,
              row.rowSha256,
            ]
          );
        } else if (existingRes.rows[0].row_sha256 !== row.rowSha256) {
          // CHANGED row
          changedCount++;
          await this.db.query(
            `UPDATE orders
             SET ref_code = $1, customer_name = $2, material = $3, ordered_pcs = $4,
                 source_row = $5, row_sha256 = $6, last_synced_at = CURRENT_TIMESTAMP, sync_status = 'CHANGED'
             WHERE wo_no = $7`,
            [
              row.refCode,
              row.customerName,
              row.material,
              row.orderedPcs,
              row.sourceRow,
              row.rowSha256,
              row.woNo,
            ]
          );
        } else {
          // UNCHANGED row
          unchangedCount++;
          await this.db.query(
            `UPDATE orders
             SET last_synced_at = CURRENT_TIMESTAMP, sync_status = 'UNCHANGED'
             WHERE wo_no = $1`,
            [row.woNo]
          );
        }
      }

      await this.db.query(
        `UPDATE order_sync_state
         SET status = 'IDLE',
             last_sync_time = CURRENT_TIMESTAMP,
             rows_processed = $1,
             new_rows = $2,
             changed_rows = $3,
             unchanged_rows = $4,
             error_message = NULL
         WHERE id = 1`,
        [parsedRows.length, newCount, changedCount, unchangedCount]
      );

      return {
        newRows: newCount,
        changedRows: changedCount,
        unchangedRows: unchangedCount,
        totalRows: parsedRows.length,
      };
    } catch (err: any) {
      console.error('[Google Sheets API] Sync failed:', err);
      await this.db.query(
        `UPDATE order_sync_state
         SET status = 'ERROR',
             error_message = $1
         WHERE id = 1`,
        [err?.message || String(err)]
      );
      return { newRows: 0, changedRows: 0, unchangedRows: 0, totalRows: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  private resolveGoogleAuth(): { auth: any; isPlaceholder: boolean } | null {
    // 1. Check raw JSON key in GOOGLE_SERVICE_ACCOUNT_KEY
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (rawKey && rawKey.trim().startsWith('{')) {
      try {
        const credentials = JSON.parse(rawKey);
        if (
          credentials.private_key?.includes('PLACEHOLDER') ||
          credentials.private_key?.includes('YOUR_REAL_PRIVATE_KEY') ||
          credentials.private_key?.includes('REPLACE_WITH') ||
          !credentials.private_key
        ) {
          return { auth: null, isPlaceholder: true };
        }
        return {
          auth: new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
          }),
          isPlaceholder: false,
        };
      } catch (e) {
        console.warn('[Google Sheets API] Could not parse GOOGLE_SERVICE_ACCOUNT_KEY JSON string.');
      }
    }

    // 2. Check JSON file path in GOOGLE_APPLICATION_CREDENTIALS or default paths
    const candidatePaths = [
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      './credentials/google-service-account.json',
      './service-account.json',
    ].filter(Boolean) as string[];

    for (const credPath of candidatePaths) {
      const resolvedPath = path.resolve(process.cwd(), credPath);
      if (fs.existsSync(resolvedPath)) {
        try {
          const fileRaw = fs.readFileSync(resolvedPath, 'utf-8');
          const parsed = JSON.parse(fileRaw);
          if (
            parsed.private_key?.includes('PLACEHOLDER') ||
            parsed.private_key?.includes('YOUR_REAL_PRIVATE_KEY') ||
            parsed.private_key?.includes('REPLACE_WITH') ||
            parsed.private_key_id?.includes('preview_placeholder') ||
            parsed._comment?.includes('SAFE PLACEHOLDER')
          ) {
            return { auth: null, isPlaceholder: true };
          }

          return {
            auth: new google.auth.GoogleAuth({
              keyFile: resolvedPath,
              scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            }),
            isPlaceholder: false,
          };
        } catch (e) {
          console.warn(`[Google Sheets API] Failed to load key file from ${resolvedPath}`);
        }
      }
    }

    return null;
  }

  public parseSheetValues(values: any[][]): RawOrderRow[] {
    if (!values || values.length === 0) return [];

    const result: RawOrderRow[] = [];
    const firstRow = values[0].map(v => String(v || '').trim().toLowerCase());
    const hasHeader = firstRow.some(col => col.includes('wo') || col.includes('ref') || col.includes('order'));
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < values.length; i++) {
      const row = values[i];
      if (!row || row.length === 0) continue;

      const refCode = String(row[0] ?? '').trim(); // Preserves leading zeros (e.g., '0041')
      const woNo = String(row[1] ?? '').trim(); // Exact string (e.g., '26-27-T01995')
      const customerName = String(row[2] ?? '').trim();
      const material = String(row[3] ?? '').trim();
      const rawPcs = String(row[4] ?? '').replace(/,/g, '').trim();
      const orderedPcs = parseInt(rawPcs, 10) || 0;

      if (!woNo) continue;

      const rowSha256 = crypto
        .createHash('sha256')
        .update(`${refCode}|${woNo}|${customerName}|${material}|${orderedPcs}`)
        .digest('hex');

      result.push({
        sourceRow: i + 1,
        refCode,
        woNo,
        customerName,
        material,
        orderedPcs,
        rowSha256,
      });
    }

    return result;
  }
}
