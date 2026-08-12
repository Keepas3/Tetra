'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  type GameModeInfo, VERSUS_TOP_ROW, TWO_V_TWO_MODES, CASUAL_MODES, ALL_VERSUS_MODES,
} from './gameModes';

// The site's landing hub — lichess.org's front page was the original visual
// reference (game-mode grid front and center); chess.com's left sidebar
// (see NavBar.tsx) replaced the top-bar nav in a later pass. This pass
// restructures the page content itself, per direct follow-up request:
// Arena moves to the literal top of the page as a full-width, entirely
// clickable showcase band (not just a card among others), and the mode
// grid below it splits into two IA groups matching how these modes are
// actually experienced — VERSUS (you're playing against someone: ranked,
// free-for-all, and team-vs-team co-op) vs CASUAL (no opponent at all:
// solo practice, plus the two co-op-with-a-partner-but-no-enemy modes,
// which are online but non-competitive in the same sense Zen/40L/Blitz are
// non-competitive — see each section's own comment below for why the split
// lands where it does).
//
// Background: a live self-playing Tetris board (both for the Arena
// showcase and the page background) was named again in this request and
// set aside again for the same reason as before — it needs a bot/demo-play
// loop that doesn't exist anywhere in this codebase, a meaningfully bigger
// separate effort. What's here instead: the Arena showcase gets a static,
// deterministic-pattern mini-board visual (a plausible mid-game snapshot,
// not simulated play) so it reads as "a game is happening here" without
// actually running one; the page background keeps the lighter drifting-
// tetromino motif from the previous pass.

interface ModeTileProps extends GameModeInfo {
  // Versus-section tiles only (Casual tiles omit these entirely and fall
  // back to the plain-Link behavior below) — see VersusModesSection's own
  // comment for the interaction this drives: check the box to add this mode
  // to a multi-mode search, or click the tile itself to search for just
  // this one mode immediately, bypassing the checkbox selection.
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onDirectSearch?: (id: string) => void;
}

function ModeTile({ id, href, label, blurb, soon, selected, onToggleSelect, onDirectSearch }: ModeTileProps) {
  const queueable = !!onDirectSearch && !soon;

  const content = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.02rem', fontWeight: 'bold', letterSpacing: '0.06em', color: soon ? 'rgba(255,255,255,0.5)' : 'white' }}>{label}</span>
        {soon && (
          <span style={{
            fontSize: '0.55rem', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            Soon
          </span>
        )}
      </div>
      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>{blurb}</span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.4rem',
    backgroundColor: 'rgba(5,5,8,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    padding: '1rem 1.15rem', textDecoration: 'none', color: 'inherit',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)', transition: 'transform 0.15s, border-color 0.15s, box-shadow 0.15s',
  };

  const hoverOn = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = 'translateY(-2px)';
    e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--tt-accent) 55%, transparent)';
    e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,0.4), 0 0 20px color-mix(in srgb, var(--tt-accent) 18%, transparent)';
  };
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.transform = 'translateY(0)';
    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
    e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
  };

  const checkbox = queueable && (
    <button
      type="button"
      aria-label={selected ? `Remove ${label} from queue selection` : `Add ${label} to queue selection`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect?.(id!); }}
      style={{
        position: 'absolute', top: '0.7rem', right: '0.7rem', width: '17px', height: '17px', flexShrink: 0,
        borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${selected ? 'var(--tt-accent)' : 'rgba(255,255,255,0.3)'}`,
        backgroundColor: selected ? 'var(--tt-accent)' : 'rgba(0,0,0,0.35)', cursor: 'pointer', padding: 0,
      }}
    >
      {selected && <span style={{ color: 'black', fontSize: '0.65rem', lineHeight: 1, fontWeight: 'bold' }}>✓</span>}
    </button>
  );

  if (soon) {
    return <div style={{ ...baseStyle, opacity: 0.65, cursor: 'default' }}>{content}</div>;
  }

  if (queueable) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onDirectSearch?.(id!)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDirectSearch?.(id!); }}
        style={{ ...baseStyle, cursor: 'pointer' }}
        onMouseOver={hoverOn}
        onMouseOut={hoverOff}
      >
        {checkbox}
        {content}
      </div>
    );
  }

  return (
    <Link href={href} style={baseStyle} onMouseOver={hoverOn} onMouseOut={hoverOff}>
      {content}
    </Link>
  );
}

function SectionLabel({ children, sub }: { children: React.ReactNode; sub?: boolean }) {
  return (
    <p style={{
      fontSize: sub ? '0.62rem' : '0.7rem', color: sub ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.45)',
      letterSpacing: '0.2em', textTransform: 'uppercase', margin: sub ? '0 0 0.55rem 0' : '0 0 0.75rem 0',
      fontWeight: 'bold',
    }}>
      {children}
    </p>
  );
}

interface TileGridProps {
  tiles: GameModeInfo[];
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onDirectSearch?: (id: string) => void;
}

function TileGrid({ tiles, selected, onToggleSelect, onDirectSearch }: TileGridProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem' }}>
      {tiles.map((t) => (
        <ModeTile
          key={t.id}
          {...t}
          selected={selected?.has(t.id)}
          onToggleSelect={onToggleSelect}
          onDirectSearch={onDirectSearch}
        />
      ))}
    </div>
  );
}

// General Versus queue — select any combination of the room-based Versus
// modes and "search" across all of them at once, rather than committing to
// one tile up front. Per direct request, the actual matchmaking behind this
// isn't built yet (no equivalent of useQuickplay.ts wired in — this needs
// its own thinking about how "queueing for several modes at once" resolves
// once a match is found, a bigger question than this pass covers) — this is
// the interactive shell only: real checkbox/search state, no network call.
//
// Two ways to start a search, per direct follow-up request replacing the
// original separate "Quick Queue" box: (1) check a tile's own top-right
// checkbox to add it to a multi-mode selection, which raises a bottom
// SelectionBar to search across everything currently checked; (2) click a
// tile directly (not its checkbox) to immediately search for just that one
// mode, bypassing the checkbox selection entirely — "if the user just
// straight selects the gamemode without clicking the button [checkbox], it
// just queues for that one specific mode," per the request's own wording.
// Both paths land on the same SearchingToast. Ranked has no checkbox and no
// direct-search handler at all (ModeTile's own `soon` check disables both),
// consistent with it not being selectable anywhere else on this page yet.
function VersusModesSection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchingModes, setSearchingModes] = useState<string[] | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const labelFor = (id: string) => ALL_VERSUS_MODES.find((t) => t.id === id)?.label ?? id;

  const startSelectedSearch = () => {
    setSearchingModes(Array.from(selected));
    setSelected(new Set());
  };

  const directSearch = (id: string) => {
    setSelected(new Set());
    setSearchingModes([id]);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <TileGrid tiles={VERSUS_TOP_ROW} selected={selected} onToggleSelect={toggleSelect} onDirectSearch={directSearch} />
        <div>
          <SectionLabel sub>Co-op vs Co-op</SectionLabel>
          <TileGrid tiles={TWO_V_TWO_MODES} selected={selected} onToggleSelect={toggleSelect} onDirectSearch={directSearch} />
        </div>
      </div>

      {selected.size > 0 && (
        <SelectionBar
          modeLabels={Array.from(selected).map(labelFor)}
          onSearch={startSelectedSearch}
          onClear={() => setSelected(new Set())}
        />
      )}
      {searchingModes && (
        <SearchingToast modeLabels={searchingModes.map(labelFor)} onCancel={() => setSearchingModes(null)} />
      )}
    </>
  );
}

// The popup named in the request — a bottom bar (not blocking the page)
// that appears once at least one tile's checkbox is on, offering to search
// across everything currently checked. Separate from SearchingToast (which
// only shows once a search has actually "started") so the two states never
// overlap or get confused for one another.
function SelectionBar({ modeLabels, onSearch, onClear }: { modeLabels: string[]; onSearch: () => void; onClear: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 50,
        display: 'flex', alignItems: 'center', gap: '1rem',
        backgroundColor: 'rgba(8,8,12,0.95)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid color-mix(in srgb, var(--tt-accent) 40%, transparent)', borderRadius: '10px',
        padding: '0.75rem 0.9rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 24px color-mix(in srgb, var(--tt-accent) 20%, transparent)',
        fontFamily: 'monospace',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.75rem', color: 'white' }}>
        <strong>{modeLabels.length}</strong> mode{modeLabels.length > 1 ? 's' : ''} selected
        <span style={{ color: 'rgba(255,255,255,0.5)' }}> — {modeLabels.join(' · ')}</span>
      </p>
      <button
        type="button"
        onClick={onClear}
        style={{
          flexShrink: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
          color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.08em',
          textTransform: 'uppercase', padding: '0.4rem 0.6rem', cursor: 'pointer',
        }}
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onSearch}
        style={{
          flexShrink: 0, backgroundColor: 'var(--tt-accent)', color: 'black', fontWeight: 'bold', border: 'none',
          borderRadius: '6px', padding: '0.4rem 0.9rem', fontFamily: 'monospace', fontSize: '0.7rem',
          letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
        }}
      >
        Search
      </button>
    </div>
  );
}

// The "hanging box" option named in the request, rather than a dedicated
// queue screen — a fixed corner notification so browsing the rest of the
// page still works while it's up. No real search runs behind it (see
// VersusQueueBox's own comment) — Cancel just dismisses it.
function SearchingToast({ modeLabels, onCancel }: { modeLabels: string[]; onCancel: () => void }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 50,
        display: 'flex', alignItems: 'center', gap: '0.9rem',
        backgroundColor: 'rgba(8,8,12,0.95)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid color-mix(in srgb, var(--tt-accent) 40%, transparent)', borderRadius: '10px',
        padding: '0.9rem 1.1rem', boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 24px color-mix(in srgb, var(--tt-accent) 20%, transparent)',
        fontFamily: 'monospace', maxWidth: '320px',
      }}
    >
      <span style={{
        width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
        backgroundColor: 'var(--tt-accent)', animation: 'tt-pulse 1.2s ease-in-out infinite',
      }} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: '0 0 0.15rem 0', fontSize: '0.78rem', color: 'white', fontWeight: 'bold' }}>
          Searching for opponent…
        </p>
        <p style={{ margin: 0, fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)' }}>
          {modeLabels.join(' · ')}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        style={{
          flexShrink: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
          color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.08em',
          textTransform: 'uppercase', padding: '0.35rem 0.6rem', cursor: 'pointer',
        }}
      >
        Cancel
      </button>
      <style>{`
        @keyframes tt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] span:first-child { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

export default function HomePage() {
  return (
    <div style={{ position: 'relative', minHeight: '100%', width: '100%', overflow: 'hidden', fontFamily: 'monospace' }}>
      <BackgroundDecoration />

      <main style={{ position: 'relative', zIndex: 1, maxWidth: '1080px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', letterSpacing: '0.3em', margin: '0 0 1.25rem 0', textTransform: 'uppercase' }}>
          Tetris Arena
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ArenaShowcase />
          <TwoVTwoShowcase />
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', letterSpacing: '0.06em', margin: '2rem 0 2.25rem 0' }}>
          Or pick a format below — ranked and team play, or practice with no opponent at all.
        </p>

        <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 480px', display: 'flex', flexDirection: 'column', gap: '2.25rem' }}>
            <div>
              <SectionLabel>Versus</SectionLabel>
              <p style={{ margin: '0 0 0.9rem 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)' }}>
                All room modes below share the same lobby — pick Game Mode once you&rsquo;re in. Check a box to queue for several at once, or click a tile to search that one right away.
              </p>
              <VersusModesSection />
            </div>
            <div>
              <SectionLabel>Casual</SectionLabel>
              <TileGrid tiles={CASUAL_MODES} />
            </div>
          </div>

          {/* Side panel — same role as lichess's own right column (create/
              join/challenge shortcuts), scoped to what this project actually
              has rather than mirroring every lichess widget (no donate/swag/
              forum here, out of scope for a personal sandbox). */}
          <div style={{
            flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '0.6rem',
            backgroundColor: 'rgba(5,5,8,0.72)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '1.1rem 1.25rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}>
            <SectionLabel>Quick Links</SectionLabel>
            {[
              { href: '/versus', label: 'Create a Room' },
              { href: '/versus', label: 'Join with a Code' },
              { href: '/arena', label: 'Arena — Public Match' },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                style={{
                  color: 'rgba(255,255,255,0.75)', textDecoration: 'none', fontSize: '0.8rem',
                  padding: '0.5rem 0.6rem', borderRadius: '6px', transition: 'background-color 0.15s, color 0.15s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--tt-accent) 12%, transparent)'; e.currentTarget.style.color = 'var(--tt-accent)'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

// Deterministic (not Math.random — this file renders on the server for the
// initial HTML same as any other client component, and a random pattern
// would disagree between that render and the client's own, a hydration
// mismatch) "mid-game" cell pattern for the Arena showcase's mini-board —
// purely decorative, gestures at "a game is happening" without simulating
// one. 6 cols x 10 rows, values index into MINI_BOARD_COLORS (0 = empty).
const MINI_BOARD_COLORS = ['transparent', '#38bdf8', '#fbbf24', '#a78bfa', '#4ade80', '#f87171', '#fb923c'];
const MINI_BOARD_PATTERN = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0],
  [0, 0, 3, 3, 0, 0],
  [0, 0, 3, 0, 0, 0],
  [0, 2, 2, 4, 4, 0],
  [1, 2, 2, 4, 4, 0],
  [1, 1, 5, 5, 6, 0],
  [1, 3, 5, 5, 6, 6],
  [3, 3, 3, 4, 4, 6],
  [1, 1, 2, 2, 5, 5],
];

// A second deterministic pattern (same reasoning as MINI_BOARD_PATTERN
// above — fixed, not random, to avoid a hydration mismatch) so the 2v2
// showcase's two side-by-side boards read as two distinct players rather
// than one board mirrored.
const TEAMMATE_BOARD_PATTERN = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0],
  [0, 0, 0, 6, 6, 0],
  [0, 5, 5, 6, 6, 0],
  [0, 5, 5, 2, 2, 0],
  [1, 4, 4, 2, 2, 0],
  [1, 4, 4, 3, 0, 0],
  [1, 1, 3, 3, 3, 0],
  [2, 2, 5, 5, 6, 6],
  [2, 2, 5, 5, 6, 6],
];

function MiniBoardPreview({ pattern }: { pattern: number[][] }) {
  return (
    <div aria-hidden style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 10px)', gridTemplateRows: 'repeat(10, 10px)', gap: '2px' }}>
      {pattern.flatMap((row, y) =>
        row.map((cell, x) => (
          <div
            key={`${y}-${x}`}
            style={{
              width: '10px', height: '10px', borderRadius: '2px',
              backgroundColor: cell ? MINI_BOARD_COLORS[cell] : 'rgba(255,255,255,0.05)',
              boxShadow: cell ? `0 0 6px ${MINI_BOARD_COLORS[cell]}66` : 'none',
            }}
          />
        ))
      )}
    </div>
  );
}

// Two boards side by side (a teammate's board next to your own) rather than
// one — the visual difference from Arena's single MiniBoardPreview is what
// signals "this one's about playing together," at a glance, matching the
// "2P"-tag language TetrisGame.tsx's own co-op canvas overlay already uses.
function DuoBoardsPreview() {
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <MiniBoardPreview pattern={MINI_BOARD_PATTERN} />
      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem', fontWeight: 'bold' }}>+</span>
      <MiniBoardPreview pattern={TEAMMATE_BOARD_PATTERN} />
    </div>
  );
}

interface ShowcaseProps {
  href: string;
  badgeText: string;
  badgeColor: string;
  title: string;
  description: string;
  decoration: React.ReactNode;
  accentFrom: string;
  accentTo: string;
}

// Shared by ArenaShowcase and TwoVTwoShowcase — same full-width, entirely-
// clickable band treatment for both, so the two headline entry points read
// as siblings rather than one being a lesser version of the other. Each
// still gets its own accent-color pairing (`accentFrom`/`accentTo`, fed
// through the same color-mix gradient/glow formula) so they're visually
// distinguishable from one another, not just differently labeled.
function Showcase({ href, badgeText, badgeColor, title, description, decoration, accentFrom, accentTo }: ShowcaseProps) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem', flexWrap: 'wrap',
        textDecoration: 'none', color: 'inherit',
        padding: '2rem 2.5rem', borderRadius: '16px',
        background: `linear-gradient(135deg, color-mix(in srgb, ${accentFrom} 24%, black) 0%, color-mix(in srgb, ${accentTo} 18%, black) 100%)`,
        border: `1px solid color-mix(in srgb, ${accentFrom} 45%, transparent)`,
        boxShadow: `0 16px 46px rgba(0,0,0,0.5), 0 0 46px color-mix(in srgb, ${accentFrom} 22%, transparent)`,
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 18px 52px rgba(0,0,0,0.55), 0 0 60px color-mix(in srgb, ${accentFrom} 32%, transparent)`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = `0 16px 46px rgba(0,0,0,0.5), 0 0 46px color-mix(in srgb, ${accentFrom} 22%, transparent)`;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        {decoration}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <span style={{
              fontSize: '0.6rem', fontWeight: 'bold', color: badgeColor, border: `1px solid color-mix(in srgb, ${badgeColor} 40%, transparent)`,
              borderRadius: '4px', padding: '2px 6px', letterSpacing: '0.1em',
            }}>
              {badgeText}
            </span>
            <span style={{ fontSize: '1.65rem', fontWeight: 'bold', letterSpacing: '0.08em', color: 'white' }}>
              {title}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', maxWidth: '440px', lineHeight: 1.5 }}>
            {description}
          </p>
        </div>
      </div>
      <span style={{
        flexShrink: 0, backgroundColor: accentFrom, color: 'black', fontWeight: 'bold',
        padding: '10px 28px', borderRadius: '8px', fontSize: '0.8rem', letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        Play Now →
      </span>
    </Link>
  );
}

// The literal top of the page, per direct request — the entire band is one
// link (not a button floating inside a bigger card), so "one click anywhere
// in the space" is true of the whole thing, not just a CTA in the corner of
// it. The mini-board is the stand-in for the "playing in the background"
// idea named in the request — see the file-header comment for why an
// actually-live board isn't what's rendering here yet.
function ArenaShowcase() {
  return (
    <Showcase
      href="/arena"
      badgeText="LIVE"
      badgeColor="#7ee787"
      title="Arena"
      description="No lobby, no waiting on friends — land here and you’re in the next public battle royale. Up to 100 players, last one standing."
      decoration={<MiniBoardPreview pattern={MINI_BOARD_PATTERN} />}
      accentFrom="var(--tt-accent)"
      accentTo="var(--tt-accent-secondary)"
    />
  );
}

// The second headline entry point, per direct request — "probably the
// biggest draw to the site." Kept immediately below Arena (not replacing
// it) rather than reordering it ahead of Ranked/Versus within the grid
// further down: Arena is the one truly zero-friction option (one click, no
// partner needed), so it stays the very first thing anyone lands on: a
// solo visitor with nobody to play with yet still hits a real "play now" —
// 2v2 Co-op gets full showcase weight of its own right underneath it, still
// very much "first thing you see," without displacing the one option that
// works with zero setup. Routes to /versus like every other room-based tile
// on this page — there's no dedicated 2v2 URL, Game Mode (Teams or Teams
// Co-op) is picked once inside the room, same as everywhere else.
function TwoVTwoShowcase() {
  return (
    <Showcase
      href="/versus"
      badgeText="TEAM UP"
      badgeColor="var(--tt-accent)"
      title="2v2 Co-op"
      description="Bring a friend and take on another team — separate boards or one shared board between you. The format built for playing together, not just against each other."
      decoration={<DuoBoardsPreview />}
      accentFrom="var(--tt-accent-secondary)"
      accentTo="var(--tt-accent)"
    />
  );
}

// Pure decoration — a faint grid texture plus a handful of static, slowly
// drifting tetromino silhouettes. aria-hidden and pointer-events:none since
// it carries no information. Deliberately not a live board simulation (see
// the file-header comment on why that's out of scope for this pass).
function BackgroundDecoration() {
  const pieces = [
    { left: '6%', top: '12%', size: 46, rotate: -12, color: 'var(--tt-accent)', delay: '0s' },
    { left: '85%', top: '8%', size: 60, rotate: 18, color: 'var(--tt-accent-secondary)', delay: '1.2s' },
    { left: '12%', top: '68%', size: 38, rotate: 8, color: 'var(--tt-accent-secondary)', delay: '2.1s' },
    { left: '90%', top: '62%', size: 52, rotate: -20, color: 'var(--tt-accent)', delay: '0.6s' },
    { left: '48%', top: '4%', size: 30, rotate: 30, color: 'var(--tt-accent)', delay: '1.8s' },
  ];
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 20%, black 40%, transparent 90%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 20%, black 40%, transparent 90%)',
      }} />
      {pieces.map((p, i) => (
        <div
          key={i}
          className={`tt-drift-piece-${i}`}
          style={{
            position: 'absolute', left: p.left, top: p.top, width: p.size, height: p.size,
            backgroundColor: p.color, opacity: 0.08, borderRadius: '6px',
          }}
        />
      ))}
      {/* Per-piece keyframes rather than one shared animation — each piece
          keeps its own rotation across the drift instead of snapping back to
          0deg every cycle (a shared keyframe has no way to reference a
          per-element rotate value). Only 5 pieces, cheap to generate. */}
      <style>{`
        ${pieces.map((p, i) => `
          @keyframes tt-drift-${i} {
            from { transform: translateY(0) rotate(${p.rotate}deg); }
            to { transform: translateY(18px) rotate(${p.rotate}deg); }
          }
          .tt-drift-piece-${i} { animation: tt-drift-${i} 9s ease-in-out ${p.delay} infinite alternate; }
        `).join('\n')}
        @media (prefers-reduced-motion: reduce) {
          [class^="tt-drift-piece-"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
