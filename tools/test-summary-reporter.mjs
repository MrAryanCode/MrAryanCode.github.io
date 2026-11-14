// node:test custom reporter: writes one JSON line with the overall counts.
export default async function* (source) {
  let overall = null;
  for await (const event of source) {
    if (event.type === 'test:summary' && event.data.file === undefined) {
      overall = event.data.counts;
    }
  }
  if (overall === null) throw new Error('node:test emitted no overall test:summary');
  yield JSON.stringify({
    total: overall.tests,
    passed: overall.passed,
    failed: overall.failed + overall.cancelled,
    skipped: overall.skipped + overall.todo,
    raw: overall,
  }) + '\n';
}
