'use client';

import TetrisApp from '@/components/TetrisApp';

export default function Home() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <TetrisApp />
    </div>
  );
}
