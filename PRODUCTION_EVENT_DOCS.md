# Production Event Engine & Resumption Logic

## 1. State Comparison Architecture
The `StateComparator` compares the previous database state against newly parsed CNC files on every scan cycle (default: every 3 seconds).

```
[CNC Share Folder] 
       │
       ▼
 [File Parser] ──> Extracts (FBT, OTD, CNI, z01)
       │
       ▼
[State Comparator] 
       │
       ├─ If sheet status == 'COMPLETED' AND sheet NOT in DB:
       │    └──> Generate New Immutable SHEET_COMPLETED Event
       │
       ├─ If active job changes AND previous job incomplete:
       │    └──> Set previous job status = 'PAUSED'
       │
       └─ If job with existing sheets is active again:
            └──> Mark job status = 'ACTIVE' (RESUMPTION DETECTED)
```

## 2. Multi-Day Job Resumption Walkthrough
Consider the core scenario:
- **Day 1**: Job A cuts 5 of 10 programmed sheets.
- **Day 1 Afternoon**: Operator switches to Job B and cuts 2 sheets.
- **Day 2**: Operator resumes Job A and cuts the remaining 5 sheets.

### Execution Trace:
1. **Day 1**:
   - `production_events` receives 5 rows for Job A (date = Day 1).
   - `production_events` receives 2 rows for Job B (date = Day 1).
   - Day 1 Metric: 7 sheets cut (Job A = 5, Job B = 2).
2. **Day 2**:
   - Job A is active again. Comparator notices sheets 1–5 are already completed and recorded.
   - When sheet 6 finishes, Comparator inserts event for Sheet #6 with `production_date = Day 2`.
   - Idempotency check: Sheets 1–5 are skipped because `(job_id, sheet_index, event_type)` already exists.
   - Day 2 Metric: 5 sheets cut (Job A = 5).
3. **Lifetime Totals**:
   - Job A lifetime = 10 sheets completed.
   - Job B lifetime = 2 sheets completed.
   - Zero double-counting across day boundaries.

## 3. Formulas & Accuracy
- **Mother Sheet Area**:
  $$\text{Area (m}^2) = \frac{\text{DimX}}{1000.0} \times \frac{\text{DimY}}{1000.0}$$
- **Daily Area**: Sum of area for all events where `production_date = :target_date`.
- **Daily Pieces**: Sum of pieces count for all events where `production_date = :target_date`.
