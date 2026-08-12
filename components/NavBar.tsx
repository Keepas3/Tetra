'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { type GameModeInfo, ARENA_MODE, VERSUS_TOP_ROW, TWO_V_TWO_MODES, CASUAL_MODES } from './gameModes';

// Exported so pages can offset their content to the right of this fixed
// sidebar instead of hardcoding the same number in several places — was
// NAV_BAR_HEIGHT/a top bar before this pass, now a left sidebar (chess.com's
// left nav was the explicit visual reference, replacing the earlier
// lichess-style top bar this project started with).
export const NAV_BAR_WIDTH = 220;

// Simple stroke-based inline icons (24x24, currentColor) rather than emoji —
// keeps rendering consistent across platforms and matches this project's
// otherwise icon-free, color/geometry-driven visual language better than
// emoji would. Each is deliberately tiny (a handful of primitives), not
// hand-authored complex path data.
function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17 14v7M14 17.5h6" />
    </svg>
  );
}
function StudyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6c-1.5-1.2-3.6-2-6-2-1 0-1.8.1-2.5.3v13c.7-.2 1.5-.3 2.5-.3 2.4 0 4.5.8 6 2" />
      <path d="M12 6c1.5-1.2 3.6-2 6-2 1 0 1.8.1 2.5.3v13c-.7-.2-1.5-.3-2.5-.3-2.4 0-4.5.8-6 2V6z" />
    </svg>
  );
}
function PuzzleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h4v2.5a1.5 1.5 0 0 0 3 0V3h4a1 1 0 0 1 1 1v4h-2.5a1.5 1.5 0 0 0 0 3H21v4a1 1 0 0 1-1 1h-4v-2.5a1.5 1.5 0 0 0-3 0V21H9a1 1 0 0 1-1-1v-4H5.5a1.5 1.5 0 0 1 0-3H8V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
function LeaderboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2.5 1.8 4.5 4 4.9M17 6h3a1 1 0 0 1 1 1c0 2.5-1.8 4.5-4 4.9" />
    </svg>
  );
}
function CommunityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.5 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M14.5 20a5 5 0 0 1 8 0" />
    </svg>
  );
}
function AboutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </svg>
  );
}
function AccountIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  );
}

const groupLabelStyle: React.CSSProperties = {
  fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em',
  textTransform: 'uppercase', marginBottom: '0.2rem',
};

const flyoutItemStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.85)', textDecoration: 'none', fontSize: '0.8rem',
  padding: '0.4rem 0.5rem', borderRadius: '4px', whiteSpace: 'nowrap',
};

// One category within the Play flyout — same GameModeInfo catalog HomePage.tsx's
// mode grid reads from (see gameModes.ts), so the two never drift out of
// sync as modes get added or renamed. A `soon` entry renders as inert text
// with the same "Soon" tag language used everywhere else on the site,
// rather than a dead link.
function FlyoutCategory({ label, modes, onNavigate }: { label: string; modes: GameModeInfo[]; onNavigate: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <span style={groupLabelStyle}>{label}</span>
      {modes.map((m) => (
        m.soon ? (
          <span
            key={m.id}
            style={{
              ...flyoutItemStyle, color: 'rgba(255,255,255,0.35)', cursor: 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem',
            }}
          >
            {m.label}
            <span style={{
              fontSize: '0.5rem', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
              padding: '1px 4px', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              Soon
            </span>
          </span>
        ) : (
          <Link key={m.id} href={m.href} style={flyoutItemStyle} onClick={onNavigate}>{m.label}</Link>
        )
      ))}
    </div>
  );
}

interface NavRowProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}

// One row of the sidebar list — shared between the real "Play" entry (which
// drives a flyout) and the not-yet-built entries below it, so both read as
// the same kind of thing rather than Play looking like a different UI
// element from its still-placeholder neighbors.
function NavRow({ icon, label, active, disabled, onMouseEnter, onMouseLeave, onClick }: NavRowProps) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%',
        background: active ? 'color-mix(in srgb, var(--tt-accent) 16%, transparent)' : 'transparent',
        border: 'none', borderRadius: '6px', padding: '0.6rem 0.75rem',
        color: disabled ? 'rgba(255,255,255,0.32)' : active ? 'var(--tt-accent)' : 'rgba(255,255,255,0.8)',
        fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0.03em',
        cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
      }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {disabled && (
        <span style={{
          fontSize: '0.55rem', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          Soon
        </span>
      )}
    </button>
  );
}

export default function NavBar() {
  const [isPlayOpen, setIsPlayOpen] = useState(false);
  // Where the flyout should sit — measured off the Play row itself rather
  // than positioned relative to it in the DOM, because the Play row lives
  // inside <nav>'s own overflowY:'auto' scroll container. Setting
  // overflow-y non-visible forces the browser to also clip overflow-x (a
  // real CSS overflow rule, not a bug in this file: per the spec, if one
  // axis is 'visible' and the other isn't, 'visible' is computed as 'auto'
  // instead) — so a flyout positioned *inside* nav and extending past the
  // sidebar's right edge was getting silently clipped to a sliver, visible
  // live as almost nothing showing on hover. Rendering the flyout as a
  // `position: fixed` sibling of <nav> (still inside <aside>, which has no
  // overflow rule) sidesteps that clipping entirely.
  const playRowRef = useRef<HTMLDivElement>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);

  const openPlayFlyout = () => {
    if (playRowRef.current) setFlyoutTop(playRowRef.current.getBoundingClientRect().top);
    setIsPlayOpen(true);
  };

  return (
    <aside
      style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: `${NAV_BAR_WIDTH}px`, zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        backgroundColor: 'rgba(10,10,14,0.92)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderRight: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace',
      }}
    >
      <Link
        href="/"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--tt-accent)', fontWeight: 'bold',
          letterSpacing: '0.1em', fontSize: '0.85rem', textDecoration: 'none', textTransform: 'uppercase',
          padding: '1.1rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span style={{
          display: 'inline-block', width: '18px', height: '18px', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--tt-accent), var(--tt-accent-secondary))', borderRadius: '4px',
        }} />
        Tetris Arena
      </Link>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.6rem 0', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        <div
          ref={playRowRef}
          onMouseEnter={openPlayFlyout}
          onMouseLeave={() => setIsPlayOpen(false)}
        >
          <NavRow icon={<PlayIcon />} label="Play" active={isPlayOpen} onClick={() => (isPlayOpen ? setIsPlayOpen(false) : openPlayFlyout())} />
        </div>

        {/* Everything below is scaffolding for later work, named directly
            from the request rather than left out — shown as real rows (not
            hidden) so the eventual site structure is visible now, but
            disabled and tagged "Soon" so nobody mistakes them for working
            features. */}
        <NavRow icon={<StudyIcon />} label="Tetris Study" disabled />
        <NavRow icon={<PuzzleIcon />} label="Puzzles" disabled />
        <NavRow icon={<LeaderboardIcon />} label="Leaderboards" disabled />
        <NavRow icon={<CommunityIcon />} label="Community" disabled />
        <NavRow icon={<AboutIcon />} label="About" disabled />
      </nav>

      {/* Account area — also future work (no accounts/login exist anywhere
          in this project yet, see CLAUDE.md's "no accounts" scoping note),
          pinned to the bottom the way chess.com's own account/settings row
          sits below its nav list rather than inside it. */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '0.75rem 0.6rem' }}>
        <NavRow icon={<AccountIcon />} label="Sign In" disabled />
      </div>

      {/* Rendered here — a sibling of <nav>, not a descendant of it — and
          `position: fixed` rather than `absolute` relative to the Play row,
          specifically to escape <nav>'s overflowY clipping (see
          `flyoutTop`'s own comment above for why that clipping happens at
          all). Needs its own hover handlers since it's no longer nested
          inside the Play row's trigger element — mousing from Play into the
          flyout has to keep isPlayOpen true, not just moving within one
          shared parent. */}
      {isPlayOpen && (
        <div
          onMouseEnter={() => setIsPlayOpen(true)}
          onMouseLeave={() => setIsPlayOpen(false)}
          style={{
            position: 'fixed', top: flyoutTop, left: NAV_BAR_WIDTH + 6,
            backgroundColor: 'rgba(10,10,15,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
            padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.9rem', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            minWidth: '200px', maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto', zIndex: 1001,
          }}
        >
          {/* Arena stands alone above the categories — the one genuinely
              zero-friction entry point (no room/partner needed), same
              outsized billing it gets on the landing page. */}
          <Link
            href={ARENA_MODE.href}
            style={{ ...flyoutItemStyle, color: '#7ee787', fontWeight: 'bold', fontSize: '0.85rem', padding: '0.4rem 0.5rem 0.6rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            onClick={() => setIsPlayOpen(false)}
          >
            {ARENA_MODE.label}
          </Link>
          <FlyoutCategory label="Versus" modes={VERSUS_TOP_ROW} onNavigate={() => setIsPlayOpen(false)} />
          <FlyoutCategory label="2v2" modes={TWO_V_TWO_MODES} onNavigate={() => setIsPlayOpen(false)} />
          <FlyoutCategory label="Casual" modes={CASUAL_MODES} onNavigate={() => setIsPlayOpen(false)} />
        </div>
      )}
    </aside>
  );
}
