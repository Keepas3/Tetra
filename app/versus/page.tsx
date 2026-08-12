'use client';

import VersusApp from '@/components/VersusApp';
import { NAV_BAR_WIDTH } from '@/components/NavBar';
import { useSearchParam } from '@/components/useSearchParam';

export default function VersusPage() {
  const code = useSearchParam('code');
  return (
    <div style={{ position: 'fixed', top: 0, left: NAV_BAR_WIDTH, right: 0, bottom: 0 }}>
      <VersusApp initialRoomCode={code} />
    </div>
  );
}
