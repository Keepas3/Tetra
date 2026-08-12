'use client';

import TetrisApp from '@/components/TetrisApp';
import { NAV_BAR_WIDTH } from '@/components/NavBar';
import { useSearchParam } from '@/components/useSearchParam';

// Formerly the site root ("/") — moved here so "/" could become the
// lichess-style landing hub instead (see components/HomePage.tsx). Behavior
// is otherwise unchanged: NavBar's Local links (?mode=standard/sprint/blitz)
// point here now instead of "/".
export default function PlayPage() {
  const mode = useSearchParam('mode');
  // Keyed by mode so clicking a different mode in the nav's Play menu while
  // already on this page (same route, just a new ?mode=) remounts TetrisApp
  // with fresh initial state instead of silently no-op'ing — a query-string
  // change alone doesn't re-run TetrisApp's useState initializer.
  return (
    <div style={{ position: 'fixed', top: 0, left: NAV_BAR_WIDTH, right: 0, bottom: 0 }}>
      <TetrisApp key={mode ?? 'title'} initialMode={mode} />
    </div>
  );
}
