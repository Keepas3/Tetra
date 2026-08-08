'use client';

import React, { useState } from 'react';
import Link from 'next/link';

// Exported so pages can offset their content below this fixed bar instead of
// hardcoding the same number in three places.
export const NAV_BAR_HEIGHT = 48;

const groupLabelStyle: React.CSSProperties = {
  fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em',
  textTransform: 'uppercase', marginBottom: '0.2rem',
};

const itemStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.85)', textDecoration: 'none', fontSize: '0.8rem',
  padding: '0.35rem 0.4rem', borderRadius: '4px', whiteSpace: 'nowrap',
};

export default function NavBar() {
  const [isPlayOpen, setIsPlayOpen] = useState(false);

  return (
    <header
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: `${NAV_BAR_HEIGHT}px`, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 1.25rem', backgroundColor: 'rgba(10,10,14,0.9)', backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.08)',
        fontFamily: 'monospace',
      }}
    >
      <Link
        href="/"
        style={{ color: 'var(--tt-accent)', fontWeight: 'bold', letterSpacing: '0.15em', fontSize: '0.85rem', textDecoration: 'none', textTransform: 'uppercase' }}
      >
        Tetris Arena
      </Link>

      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setIsPlayOpen(true)}
        onMouseLeave={() => setIsPlayOpen(false)}
      >
        <button
          onClick={() => setIsPlayOpen((open) => !open)}
          style={{
            background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)',
            fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            padding: '0.5rem 0.25rem', fontFamily: 'monospace',
          }}
        >
          Play ▾
        </button>

        {isPlayOpen && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: '4px',
              backgroundColor: 'rgba(10,10,15,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
              padding: '0.75rem', display: 'flex', gap: '1.5rem', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              minWidth: '260px', zIndex: 1001,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1 }}>
              <span style={groupLabelStyle}>Local</span>
              <Link href="/?mode=standard" style={itemStyle} onClick={() => setIsPlayOpen(false)}>Zen Mode</Link>
              <Link href="/?mode=sprint" style={itemStyle} onClick={() => setIsPlayOpen(false)}>40 Lines</Link>
              <Link href="/?mode=blitz" style={itemStyle} onClick={() => setIsPlayOpen(false)}>Blitz (3 min)</Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flex: 1, borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: '1.5rem' }}>
              <span style={groupLabelStyle}>Online</span>
              <Link href="/versus" style={{ ...itemStyle, color: '#7ee787' }} onClick={() => setIsPlayOpen(false)}>Versus (Beta)</Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
