# CNC Production Monitoring & Live Dashboard

An industrial-grade, full-stack CNC cutting table production monitoring and live tracking system. Continuously watches the CNC network share (`\\192.168.11.211\iso`) in strictly read-only mode, reverse-engineers the 4-file job groups (`.FBT`, `.OTD`, `.CNI`, `.z01`), generates immutable sheet cut events in PostgreSQL via `DATABASE_URL`, syncs automatically every 5 minutes with the Google Sheets Order Master via official Google Sheets API service account, and visualizes real-time production telemetry on an industrial dashboard.

---

## Required Architecture & Design Specifications

1. **PostgreSQL Database Engine**:
   - Production database is standard PostgreSQL accessed via `DATABASE_URL`.
   - Permanent storage of cutting history (`production_events`, `cnc_jobs`, `cnc_mother_sheets`, `cnc_pieces`, `orders`).
   - Strict `UNIQUE(job_id, sheet_index, event_type)` constraint guarantees zero duplicate events across network reconnects or file re-scans.
   - Zero reliance on Cloud SQL, Firebase, Firestore, or SQLite.

2. **Strictly Read-Only CNC File Collector**:
   - Directly monitors the Windows UNC network share: `\\192.168.11.211\iso`
   - Strictly READ-ONLY operations (`readdir`, `stat`, `readFile`). Never writes, renames, creates, or alters CNC controller files.
   - Continuous 3-second incremental polling (`CNC_SCAN_INTERVAL_MS=3000`) with in-memory hashing/stat caching.

3. **Google Sheets API Order Master Integration**:
   - Official Google Sheets API v4 integration using Google Service Account credentials.
   - Automatic background synchronization running every 5 minutes (`GOOGLE_SHEET_SYNC_INTERVAL_MS=300000`).
   - Normalizes Ref codes (preserving leading zeros, e.g. `0041`), exact WO strings, customer names, materials, and ordered quantities.
   - Replaces manual CSV downloads with secure Service Account JSON authentication.

4. **Multi-Day Job Resumption & Traceability**:
   - Accurately tracks jobs paused mid-run and resumed days later. Daily sheets and m² are grouped by exact cut date, while lifetime job completion reflects total progress.
   - Full piece-level audit trail: `Customer → WO No. → Piece → Mother Sheet → CNC Job → Production Event → Timestamp`.

---

## Architecture Diagram

```
 [CNC Machine Read-Only UNC Share: \\192.168.11.211\iso]
               │
               ▼ (Continuous 3s Read-Only Incremental Polling)
   [CncMonitorService (Node.js/Express)]
               │
               ├──> [JobCorrelator + Parsers: FBT, OTD, CNI, z01]
               │
               ├──> [StateComparator (Idempotency Engine)]
               │
               ▼
    [PostgreSQL Database (DATABASE_URL)]
    ├── cnc_jobs (Job metadata, material, dimensions, status)
    ├── cnc_mother_sheets (Sheet index, width, height, thickness, area m²)
    ├── cnc_pieces (Cut pieces, order mapping, rack, status)
    ├── production_events (Append-only immutable cut history)
    ├── orders (Google Sheet Order Master replica)
    └── cnc_monitor_state & order_sync_state
               ▲
               │ (5-Min Background Sync via Service Account JSON)
   [GoogleSheetSyncService (Google Sheets API v4)]
               │
               ▼
    [Express REST API Layer (/api/*)]
               │
               ▼
   [React 19 + Tailwind CSS Live Dashboard]
```

---

## Running Locally on Windows with Node.js and PostgreSQL

### 1. Prerequisites on Windows
- **Node.js**: v18.0.0+ or v20.0.0+ (download from [nodejs.org](https://nodejs.org/))
- **PostgreSQL**: v14+ or v16+ (download from [postgresql.org](https://www.postgresql.org/download/windows/))

### 2. Create PostgreSQL Database
In PostgreSQL (`psql` or pgAdmin):
```sql
CREATE DATABASE cnc_dashboard;
CREATE USER cnc_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE cnc_dashboard TO cnc_user;
```

### 3. Configure Local Environment Variables (`.env`)
Create a `.env` file in the project root (or copy `.env.example` to `.env`):
```env
# PostgreSQL Database Connection
DATABASE_URL="postgresql://cnc_user:<MY_LOCAL_PASSWORD>@localhost:5432/cnc_dashboard"

# CNC Machine Read-Only Network Share (Windows UNC path)
CNC_SHARE_PATH="\\\\192.168.11.211\\iso"
CNC_SCAN_INTERVAL_MS=5000
CNC_OFFLINE_GRACE_SEC=30

# Google Sheets API Configuration (5-minute background sync)
GOOGLE_SHEET_ID="1Xs0EUIs0H7fgdkwlwFOmM5HBjJ1SXzz4-D-QxGA8euM"
GOOGLE_SHEET_RANGE="Sheet1!A:E"
GOOGLE_SHEET_SYNC_INTERVAL_MS=300000

# Google Service Account Credentials
GOOGLE_APPLICATION_CREDENTIALS="./credentials/google-service-account.json"
GOOGLE_SERVICE_ACCOUNT_EMAIL="cnc-dashboard-sync@cnc-production-dashboard.iam.gserviceaccount.com"

PORT=3000
```

### 4. Place Your Service Account JSON Key
Save your downloaded Google Cloud service account JSON key file to:
```
./credentials/google-service-account.json
```
*(A template `google-service-account.json.example` is provided in the `./credentials/` folder for reference.)*

### 5. Install Dependencies & Launch
In PowerShell or Command Prompt:
```cmd
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Production Build & Run
```cmd
npm run build
npm start
```

---

## Automated Verification Suite

To run the automated verification test suite verifying all parsers, idempotency, multi-day job resumption, and Google Sheets API value normalization:
```cmd
npm test
```
Outputs:
- `✓ PASS FBT Parser Validation`
- `✓ PASS OTD Parser Validation`
- `✓ PASS CNI & z01 Parsers Validation`
- `✓ PASS File Grouping Logic`
- `✓ PASS Date Separation Guarantee`
- `✓ PASS Mother-Sheet Area Calculation`
- `✓ PASS CRITICAL E2E: Multi-Day Resume & Interruption Test`
- `✓ PASS Google Sheets API Order Master Normalization`
All 8 automated tests passing (8/8).

---

## Windows Service Deployment (Shop Floor Host PC)

To run the CNC monitor as a continuous 24/7 Windows Service that automatically starts on PC boot:

Using [NSSM (Non-Sucking Service Manager)](https://nssm.cc/):
1. Open Command Prompt as Administrator.
2. Run:
   ```cmd
   nssm install CncMonitorService "C:\Program Files\nodejs\node.exe" "C:\path\to\app\dist\server.cjs"
   nssm set CncMonitorService AppDirectory "C:\path\to\app"
   nssm set CncMonitorService Start SERVICE_AUTO_START
   nssm start CncMonitorService
   ```

---

## Documentation Index

- `CNC_PARSER_DOCS.md` — Detailed file structures for FBT, OTD, CNI, and z01.
- `DATABASE_SCHEMA.md` — PostgreSQL tables, foreign keys, and idempotency constraints.
- `PRODUCTION_EVENT_DOCS.md` — Multi-day resumption engine and state comparison logic.
- `server/tests/testSuite.ts` — Comprehensive 8-test verification harness.
