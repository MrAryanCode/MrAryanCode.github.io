export function Report() {
  return (
    <>
      <h1>Engineering report</h1>
      <p>This page is prerendered text. It ships the same Solid components as every other page and hydrates them.</p>
      <h2>Method</h2>
      <p>Each route is rendered to a string at build time and written to its own index.html.</p>
      <h2>Result</h2>
      <p>The report content reads with JavaScript disabled.</p>
      {/* The three placeholders are static text: scripts/inject-report.cjs replaces them after the gates have run. */}
      <p>Accessibility violations: <span data-q="a11y.violations">__A11Y_VIOLATIONS__</span></p>
      <p>
        Links checked: <span data-q="links.checked">__LINKS_CHECKED__</span>, broken: <span data-q="links.broken">__LINKS_BROKEN__</span>
      </p>
    </>
  );
}
