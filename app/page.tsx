import HomePage from '@/components/HomePage';
import { NAV_BAR_WIDTH } from '@/components/NavBar';

// The site's landing hub — see components/HomePage.tsx for the actual
// layout. Single-player play itself lives at /play now (see app/play/).
export default function Home() {
  return (
    <div style={{ position: 'absolute', top: 0, left: NAV_BAR_WIDTH, right: 0, bottom: 0, overflowY: 'auto' }}>
      <HomePage />
    </div>
  );
}
