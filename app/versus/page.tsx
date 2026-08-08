'use client';

import VersusApp from '@/components/VersusApp';
import { NAV_BAR_HEIGHT } from '@/components/NavBar';
import { useSearchParam } from '@/components/useSearchParam';

export default function VersusPage() {
  const code = useSearchParam('code');
  return (
    <div style={{ position: 'fixed', top: NAV_BAR_HEIGHT, left: 0, right: 0, bottom: 0 }}>
      <VersusApp initialRoomCode={code} />
    </div>
  );
}
