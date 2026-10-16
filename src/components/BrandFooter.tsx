/**
 * The small "Built by CrispinIT Labs" line shown at the bottom of every page.
 * It is rendered once in App.tsx, after the router, so no page has to remember it.
 */
export function BrandFooter() {
  return (
    <footer className="brandfoot">
      <span>Built by <b>CrispinIT Labs</b></span>
    </footer>
  );
}
