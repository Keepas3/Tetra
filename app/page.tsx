'use client';

import TetrisApp from '@/components/TetrisApp';
import { NAV_BAR_HEIGHT } from '@/components/NavBar';
import { useSearchParam } from '@/components/useSearchParam';

export default function Home() {
  const mode = useSearchParam('mode');
  // Keyed by mode so clicking a different mode in the nav's Play menu while
  // already on this page (same route, just a new ?mode=) remounts TetrisApp
  // with fresh initial state instead of silently no-op'ing — a query-string
  // change alone doesn't re-run TetrisApp's useState initializer.
  return (
    <div style={{ position: 'fixed', top: NAV_BAR_HEIGHT, left: 0, right: 0, bottom: 0 }}>
      <TetrisApp key={mode ?? 'title'} initialMode={mode} />
    </div>
  );
}
