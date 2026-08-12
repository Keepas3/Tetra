'use client';

import ArenaApp from '@/components/ArenaApp';
import { NAV_BAR_WIDTH } from '@/components/NavBar';

// No ?code= param here, unlike /versus — there's nothing to deep-link into,
// landing on this page is the entire join action.
export default function ArenaPage() {
  return (
    <div style={{ position: 'fixed', top: 0, left: NAV_BAR_WIDTH, right: 0, bottom: 0 }}>
      <ArenaApp />
    </div>
  );
}
