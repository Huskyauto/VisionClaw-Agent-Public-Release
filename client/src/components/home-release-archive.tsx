// Extracted from client/src/pages/home.tsx (Task 102 girth split) and split into
// two part-files (Task 104 girth split, 2026-07-31) — the DEMOTED "What's New"
// release-banner archive (R125+137.88+sec back to R75.A). Pure JSX cut-paste,
// zero behavior change; the newest banners stay inline in home.tsx. State
// (expanded set + toggle) stays owned by the page.
import { HomeReleaseArchivePart1 } from "./home-release-archive-part1";
import { HomeReleaseArchivePart2 } from "./home-release-archive-part2";

export function HomeReleaseArchive(props: {
  releaseExpanded: Set<string>;
  toggleRelease: (id: string) => void;
}) {
  return (
    <>
      <HomeReleaseArchivePart1 {...props} />
      <HomeReleaseArchivePart2 {...props} />
    </>
  );
}
