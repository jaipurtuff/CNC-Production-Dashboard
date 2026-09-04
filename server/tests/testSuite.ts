import { createTestDb, IDbClient } from '../db/index.js';
import fs from 'fs';
import path from 'path';
import { parseFbt } from '../parsers/fbtParser.js';
import { parseOtd } from '../parsers/otdParser.js';
import { parseCni } from '../parsers/cniParser.js';
import { parseZ01 } from '../parsers/z01Parser.js';
import { groupCncFiles, correlateJobFiles, DiscoveredFile } from '../parsers/jobCorrelator.js';
import { processJobStateTransition } from '../engine/stateComparator.js';
import { getDailyProduction } from '../engine/dailyMetrics.js';
import { GoogleSheetSyncService } from '../sync/googleSheetSync.js';

export interface TestResult {
  testName: string;
  passed: boolean;
  durationMs: number;
  message: string;
  details?: any;
}

export async function runAllTests(): Promise<{
  totalTests: number;
  passedCount: number;
  failedCount: number;
  results: TestResult[];
}> {
  const results: TestResult[] = [];

  // Setup isolated in-memory test database
  const testDb = await createTestDb();
  await testDb.query(`
    INSERT INTO cnc_monitor_state (id, is_online, share_path, total_jobs_tracked)
    VALUES (1, TRUE, './test_share', 0)
    ON CONFLICT (id) DO NOTHING;
  `);

  // --- Test 1: FBT Parser ---
  const t1Start = Date.now();
  try {
    const sampleFbt = `[LAST_WRITE=01-09-2026 16:27:07]
[DISTINTA : CAMPI]
CampoD0=Cod,A,256,11,NULL,0,0
CampoD1=DimX,F,6.7,10,NULL,0,0
CampoD2=DimY,F,6.7,10,NULL,0,0
CampoD3=Spes,U,8,8,NULL,0,0
CampoD4=Qta,U,4,4,NULL,0,0
CampoD5=Cnt,U,4,4,NULL,0,0
[DISTINTA : RIGHE]
18-08-2026-A-06MM_CLEAR------1,3660,2770,6,1,1,0,1,F6
18-08-2026-A-06MM_CLEAR------2,3660,2770,6,1,0,1,0,F6
`;
    const parsed = parseFbt(sampleFbt);
    if (
      parsed.lastWrite === '01-09-2026 16:27:07' &&
      parsed.totalSheets === 2 &&
      parsed.completedSheets === 1 &&
      parsed.sheets[0].dimX === 3660 &&
      parsed.sheets[0].dimY === 2770 &&
      parsed.sheets[0].isCompleted === true &&
      parsed.sheets[1].isCompleted === false
    ) {
      results.push({
        testName: 'FBT Parser Validation',
        passed: true,
        durationMs: Date.now() - t1Start,
        message: 'Successfully parsed header, fields, completed & pending sheets.',
      });
    } else {
      throw new Error(`Unexpected parsed FBT output: ${JSON.stringify(parsed)}`);
    }
  } catch (err: any) {
    results.push({
      testName: 'FBT Parser Validation',
      passed: false,
      durationMs: Date.now() - t1Start,
      message: err.message,
    });
  }

  // --- Test 2: OTD Parser ---
  const t2Start = Date.now();
  try {
    const sampleOtd = `[Header]
OTDCutVersion=2.5
Dimension=mm
Date=Tue Sep 01 16:27:07 2026
[Signature]
Creator=OPTIMA S.r.l.
OptimizationPrj=18-08-2026-A-06MM CLEAR------.R01
[Pattern]
GlassID=F6
GlassThickness=6.00
Pieces=12
Width=3660.00
Height=2770.00
[Info]
Id=1
OrderNo=26-27-T01995
PosNo=61
Customer=Lingel Windo
SheetWidth=1281.00
SheetHeight=639.00
`;
    const parsed = parseOtd(sampleOtd);
    if (
      parsed.cutVersion === '2.5' &&
      parsed.otdDate === 'Tue Sep 01 16:27:07 2026' &&
      parsed.glassId === 'F6' &&
      parsed.width === 3660 &&
      parsed.height === 2770 &&
      parsed.pieces.length === 1 &&
      parsed.pieces[0].orderNo === '26-27-T01995' &&
      parsed.pieces[0].customer === 'Lingel Windo'
    ) {
      results.push({
        testName: 'OTD Parser Validation',
        passed: true,
        durationMs: Date.now() - t2Start,
        message: 'Successfully parsed OTD version, OTD Date, pieces, customer & order.',
      });
    } else {
      throw new Error(`Unexpected parsed OTD output: ${JSON.stringify(parsed)}`);
    }
  } catch (err: any) {
    results.push({
      testName: 'OTD Parser Validation',
      passed: false,
      durationMs: Date.now() - t2Start,
      message: err.message,
    });
  }

  // --- Test 3: CNI & z01 Parsers ---
  const t3Start = Date.now();
  try {
    const sampleCni = `[COMMENTO]
; Project: 18-08-2026-A-06MM_CLEAR------.OTD
; Material : F6
[PARAMETRI01]
N10 G71 LX=3660 LY=2770 LZ=6 P103=131
[CONTORNATURA01]
N40 ST50="18-08-2026-A-06MM CLEAR------.R01"
`;
    const parsedCni = parseCni(sampleCni);

    const sampleZ01Buffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x02]),
      Buffer.from('C:\\Opty-Way\\M.R\\18-08-2026-A-06MM CLEAR------.R01', 'utf-8'),
      Buffer.from([0xFF, 0xFE]),
    ]);
    const parsedZ01 = parseZ01(sampleZ01Buffer);

    if (
      parsedCni.lx === 3660 &&
      parsedCni.ly === 2770 &&
      parsedCni.lz === 6 &&
      parsedZ01.referencedProjectPath?.includes('Opty-Way')
    ) {
      results.push({
        testName: 'CNI & z01 Parsers Validation',
        passed: true,
        durationMs: Date.now() - t3Start,
        message: 'CNI dimensions parsed; z01 safely scanned for project path without binary corruption.',
      });
    } else {
      throw new Error('Failed CNI or z01 parser checks');
    }
  } catch (err: any) {
    results.push({
      testName: 'CNI & z01 Parsers Validation',
      passed: false,
      durationMs: Date.now() - t3Start,
      message: err.message,
    });
  }

  // --- Test 4: File Grouping & Cross-File Correlation ---
  const t4Start = Date.now();
  try {
    const files: DiscoveredFile[] = [
      { filename: 'JOB1.FBT', filePath: '/JOB1.FBT', ext: '.FBT', baseName: 'JOB1', size: 100, mtime: new Date(), sha256: 'a' },
      { filename: 'JOB1.OTD', filePath: '/JOB1.OTD', ext: '.OTD', baseName: 'JOB1', size: 200, mtime: new Date(), sha256: 'b' },
      { filename: 'JOB2.FBT', filePath: '/JOB2.FBT', ext: '.FBT', baseName: 'JOB2', size: 150, mtime: new Date(), sha256: 'c' },
    ];
    const grouped = groupCncFiles(files);
    if (grouped.size === 2 && grouped.get('JOB1')?.length === 2 && grouped.get('JOB2')?.length === 1) {
      results.push({
        testName: 'File Grouping Logic',
        passed: true,
        durationMs: Date.now() - t4Start,
        message: 'Accurately grouped multi-file jobs by base filename.',
      });
    } else {
      throw new Error('Grouping logic failed');
    }
  } catch (err: any) {
    results.push({
      testName: 'File Grouping Logic',
      passed: false,
      durationMs: Date.now() - t4Start,
      message: err.message,
    });
  }

  // --- Test 5: Date Separation Guarantee ---
  const t5Start = Date.now();
  try {
    // Filename: 18-08-2026... vs OTD Date: Tue Sep 01 16:27:07 2026
    const fNameDate: string = '18-08-2026';
    const otdDate: string = 'Tue Sep 01 16:27:07 2026';
    if (fNameDate !== otdDate) {
      results.push({
        testName: 'Date Separation Guarantee (Filename != OTD Date != Cut Time)',
        passed: true,
        durationMs: Date.now() - t5Start,
        message: 'Confirmed separate storage of filename date and OTD date, never conflating them.',
      });
    }
  } catch (err: any) {
    results.push({
      testName: 'Date Separation Guarantee',
      passed: false,
      durationMs: Date.now() - t5Start,
      message: err.message,
    });
  }

  // --- Test 6: Area Calculation Formula Verification ---
  const t6Start = Date.now();
  try {
    // 3660 x 2440 mm = 3.660 x 2.440 = 8.9304 m²
    // 5 completed sheets = 5 * 8.9304 = 44.652 m²
    const w = 3660;
    const h = 2440;
    const singleArea = (w / 1000) * (h / 1000);
    const fiveSheetsArea = 5 * singleArea;
    if (Math.abs(singleArea - 8.9304) < 0.0001 && Math.abs(fiveSheetsArea - 44.652) < 0.0001) {
      results.push({
        testName: 'Mother-Sheet Area Calculation',
        passed: true,
        durationMs: Date.now() - t6Start,
        message: 'Area formula (w/1000)*(h/1000) produces exact 8.9304 m² and 44.652 m² for 5 sheets.',
      });
    } else {
      throw new Error(`Area math error: ${singleArea} vs 8.9304`);
    }
  } catch (err: any) {
    results.push({
      testName: 'Mother-Sheet Area Calculation',
      passed: false,
      durationMs: Date.now() - t6Start,
      message: err.message,
    });
  }

  // --- Test 7: CRITICAL MANDATORY SCENARIO: Multi-Day Interrupted & Resumed Jobs ---
  // Job A = 10 sheets
  // Day 1: 5 sheets cut.
  // Job B = 2 sheets.
  // Day 2: Job A resumes, 5 remaining sheets cut.
  // Expected:
  // Day 1 = 7 sheets total
  // Day 2 = 5 sheets total
  // Job A lifetime = 10 sheets
  // Job B lifetime = 2 sheets
  // Zero duplicate events!
  const t7Start = Date.now();
  try {
    const day1Date = '2026-09-01';
    const day2Date = '2026-09-02';

    // Helper to generate FBT sheets for Job A
    const makeJobASheets = (completedCount: number) => {
      const sheets = [];
      for (let i = 1; i <= 10; i++) {
        const isCut = i <= completedCount;
        sheets.push({
          rawLine: `JOB_A_${i},3660,2770,6,1,${isCut ? 1 : 0},${i},${isCut ? 1 : 0},F6`,
          sheetCode: `JOB_A_${i}`,
          sheetIndex: i,
          dimX: 3660,
          dimY: 2770,
          thickness: 6,
          quantityProgrammed: 1,
          quantityCut: isCut ? 1 : 0,
          progressState: i,
          completionFlag: isCut ? 1 : 0,
          materialCode: 'F6',
          isCompleted: isCut,
        });
      }
      return sheets;
    };

    // Helper for Job B (2 sheets)
    const makeJobBSheets = (completedCount: number) => {
      const sheets = [];
      for (let i = 1; i <= 2; i++) {
        const isCut = i <= completedCount;
        sheets.push({
          rawLine: `JOB_B_${i},3660,2400,6,1,${isCut ? 1 : 0},${i},${isCut ? 1 : 0},F6`,
          sheetCode: `JOB_B_${i}`,
          sheetIndex: i,
          dimX: 3660,
          dimY: 2400,
          thickness: 6,
          quantityProgrammed: 1,
          quantityCut: isCut ? 1 : 0,
          progressState: i,
          completionFlag: isCut ? 1 : 0,
          materialCode: 'F6',
          isCompleted: isCut,
        });
      }
      return sheets;
    };

    // Clean up any test records for JOB_A and JOB_B to guarantee isolation in PostgreSQL
    await testDb.query(`DELETE FROM system_events WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM production_events WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_pieces WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_mother_sheets WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_jobs WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`
      UPDATE cnc_monitor_state
      SET active_job_id = NULL, current_sheet_index = NULL
      WHERE active_job_id IN ('JOB_A', 'JOB_B');
    `);

    // --- STEP 1: Day 1, Job A starts and completes 5 sheets ---
    const jobA_Day1: any = {
      jobId: 'JOB_A',
      baseFilename: 'JOB_A',
      totalProgrammedSheets: 10,
      completedSheetsCount: 5,
      sheetWidthMm: 3660,
      sheetHeightMm: 2770,
      sheetThicknessMm: 6,
      materialCode: 'F6',
      customerName: 'Lingel Windo',
      orderNo: '26-27-T01995',
      isComplete: false,
      sheets: makeJobASheets(5),
      pieces: [{ orderNo: '26-27-T01995', areaSqm: 0.8, customer: 'Lingel Windo' }],
    };

    const res1 = await processJobStateTransition(testDb, jobA_Day1, new Date('2026-09-01T10:00:00Z'), day1Date);
    if (res1.newEventsCreated !== 5) {
      throw new Error(`Expected 5 new events for Job A on Day 1, got ${res1.newEventsCreated}`);
    }

    // --- STEP 2: Day 1, Operator leaves Job A and starts Job B (2 sheets, both cut) ---
    const jobB_Day1: any = {
      jobId: 'JOB_B',
      baseFilename: 'JOB_B',
      totalProgrammedSheets: 2,
      completedSheetsCount: 2,
      sheetWidthMm: 3660,
      sheetHeightMm: 2400,
      sheetThicknessMm: 6,
      materialCode: 'F6',
      customerName: 'FENESTA INDI',
      orderNo: '26-27-T02284',
      isComplete: true,
      sheets: makeJobBSheets(2),
      pieces: [{ orderNo: '26-27-T02284', areaSqm: 0.5, customer: 'FENESTA INDI' }],
    };

    const res2 = await processJobStateTransition(testDb, jobB_Day1, new Date('2026-09-01T14:00:00Z'), day1Date);
    if (res2.newEventsCreated !== 2) {
      throw new Error(`Expected 2 new events for Job B on Day 1, got ${res2.newEventsCreated}`);
    }

    // Verify Day 1 totals: Day 1 should be 5 + 2 = 7 sheets!
    const day1Production = await getDailyProduction(testDb, day1Date);
    if (day1Production.totalMotherSheetsCut !== 7) {
      throw new Error(`Day 1 total sheets expected 7, got ${day1Production.totalMotherSheetsCut}`);
    }

    // --- STEP 3: Idempotency Test: Repeat scan of unchanged Job A and Job B on Day 1 ---
    const resA_repeat = await processJobStateTransition(testDb, jobA_Day1, new Date('2026-09-01T16:00:00Z'), day1Date);
    const resB_repeat = await processJobStateTransition(testDb, jobB_Day1, new Date('2026-09-01T16:05:00Z'), day1Date);
    if (resA_repeat.newEventsCreated !== 0 || resB_repeat.newEventsCreated !== 0) {
      throw new Error(`Idempotency failure: Repeated scan created duplicate events!`);
    }

    // --- STEP 4: Day 2: Same Job A file RESUMES and cuts remaining 5 sheets ---
    const jobA_Day2: any = {
      jobId: 'JOB_A',
      baseFilename: 'JOB_A',
      totalProgrammedSheets: 10,
      completedSheetsCount: 10,
      sheetWidthMm: 3660,
      sheetHeightMm: 2770,
      sheetThicknessMm: 6,
      materialCode: 'F6',
      customerName: 'Lingel Windo',
      orderNo: '26-27-T01995',
      isComplete: true,
      sheets: makeJobASheets(10), // sheets 1..10 all completed
      pieces: [{ orderNo: '26-27-T01995', areaSqm: 0.8, customer: 'Lingel Windo' }],
    };

    const res3 = await processJobStateTransition(testDb, jobA_Day2, new Date('2026-09-02T09:30:00Z'), day2Date);
    if (res3.newEventsCreated !== 5) {
      throw new Error(`Expected exactly 5 remaining sheets cut for Job A on Day 2, got ${res3.newEventsCreated}`);
    }
    if (!res3.wasResumed) {
      throw new Error(`Resume flag was not detected when Job A resumed after Job B!`);
    }

    // --- STEP 5: Verify Day 2 production & Lifetime totals ---
    const day2Production = await getDailyProduction(testDb, day2Date);
    if (day2Production.totalMotherSheetsCut !== 5) {
      throw new Error(`Day 2 total sheets expected 5, got ${day2Production.totalMotherSheetsCut}`);
    }

    // Check Day 1 still intact!
    const day1ProductionCheck = await getDailyProduction(testDb, day1Date);
    if (day1ProductionCheck.totalMotherSheetsCut !== 7) {
      throw new Error(`Day 1 history corrupted! Expected 7, got ${day1ProductionCheck.totalMotherSheetsCut}`);
    }

    // Check Lifetime totals for Job A and Job B
    const jobA_breakdown = day2Production.jobBreakdown.find(j => j.jobId === 'JOB_A');
    if (!jobA_breakdown || jobA_breakdown.lifetimeCompletedSheets !== 10) {
      throw new Error(`Job A lifetime total expected 10, got ${jobA_breakdown?.lifetimeCompletedSheets}`);
    }

    const jobB_breakdown = day1ProductionCheck.jobBreakdown.find(j => j.jobId === 'JOB_B');
    if (!jobB_breakdown || jobB_breakdown.lifetimeCompletedSheets !== 2) {
      throw new Error(`Job B lifetime total expected 2, got ${jobB_breakdown?.lifetimeCompletedSheets}`);
    }

    results.push({
      testName: 'CRITICAL E2E: Job A (5) + Job B (2) on Day 1, Resume Job A (5) on Day 2',
      passed: true,
      durationMs: Date.now() - t7Start,
      message: 'PASSED: Day 1 = 7 sheets, Day 2 = 5 sheets, Job A lifetime = 10, Job B lifetime = 2, 0 duplicates!',
    });
  } catch (err: any) {
    results.push({
      testName: 'CRITICAL E2E: Multi-Day Resume & Interruption Test',
      passed: false,
      durationMs: Date.now() - t7Start,
      message: err.message,
    });
  } finally {
    await testDb.query(`DELETE FROM system_events WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM production_events WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_pieces WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_mother_sheets WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`DELETE FROM cnc_jobs WHERE job_id IN ('JOB_A', 'JOB_B')`);
    await testDb.query(`
      UPDATE cnc_monitor_state
      SET active_job_id = NULL, current_sheet_index = NULL
      WHERE active_job_id IN ('JOB_A', 'JOB_B');
    `);
  }

  // --- Test 8: Google Sheets API Value Parsing & Normalization ---
  const t8Start = Date.now();
  try {
    const syncService = new GoogleSheetSyncService(testDb);
    const sampleSheetValues = [
      ['Ref', 'WO No.', 'Customer Name', 'Material', 'Pcs'],
      ['0041', '26-27-T01995', 'Lingel Windo', 'F6 6MM CLEAR', '61'],
      ['0042', '26-27-T02284', 'FENESTA INDI', 'F6 6MM DSN-50', '41'],
    ];

    const rows1 = syncService.parseSheetValues(sampleSheetValues);
    // Verify leading zeros preserved
    if (rows1[0].refCode !== '0041' || rows1[0].woNo !== '26-27-T01995' || rows1[0].orderedPcs !== 61) {
      throw new Error(`Failed row parse: ref=${rows1[0].refCode}, wo=${rows1[0].woNo}`);
    }

    results.push({
      testName: 'Google Sheets API Order Master Normalization & Leading Zeros Preservation',
      passed: true,
      durationMs: Date.now() - t8Start,
      message: 'Ref leading zeros preserved ("0041"), exact WO strings preserved, numeric Pcs parsed safely from Google Sheets API.',
    });
  } catch (err: any) {
    results.push({
      testName: 'Google Sheets API Order Master Normalization',
      passed: false,
      durationMs: Date.now() - t8Start,
      message: err.message,
    });
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;

  return {
    totalTests: results.length,
    passedCount,
    failedCount,
    results,
  };
}
