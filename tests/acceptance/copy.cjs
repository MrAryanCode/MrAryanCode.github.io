// Copy that the user signs off in step 3 (P-10, design.md DS-00). Until a copy task is amended with the exact string,
// its constant is null and the test that needs it fails with `copy not signed off`.
// Each constant lives in the spec that uses it, so a feature task edits only its own spec.
const { expect } = require('@playwright/test');

function signed(value, name) {
  expect(value, `copy not signed off: ${name}`).not.toBeNull();
}

module.exports = { signed };
