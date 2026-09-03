import { runAllTests } from './testSuite.js';

async function main() {
  console.log('====================================================');
  console.log('  CNC Production Monitoring — Automated Test Suite  ');
  console.log('====================================================\n');

  try {
    const summary = await runAllTests();

    for (const r of summary.results) {
      const mark = r.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${mark} [${r.durationMs}ms] ${r.testName}`);
      console.log(`       ${r.message}`);
    }

    console.log('\n----------------------------------------------------');
    console.log(`Total Tests: ${summary.totalTests} | Passed: ${summary.passedCount} | Failed: ${summary.failedCount}`);
    console.log('----------------------------------------------------');

    if (summary.failedCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during test execution:', err);
    process.exit(1);
  }
}

main();
