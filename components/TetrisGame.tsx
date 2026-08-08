'use client';

import React, { useEffect, useRef, useState } from 'react';
import { COLS, ROWS, BLOCK_SIZE, COLORS, PIECES } from './tetrisConstants';
import { supabase } from '../app/utils/supabaseClient'; 

interface TetrisGameProps {
  mode: string;
  onMenu: () => void;
  // Versus-mode-only bridge to the room's Realtime channel (owned by
  // VersusApp/useOnlineRoom) — TetrisGame stays otherwise unaware of
  // Supabase, it just sends/receives plain data through these.
  onAttack?: (amount: number) => void;
  incomingGarbage?: { amount: number; seq: number } | null;
  // Win condition is last-player-standing: onEliminated fires once when this
  // client tops out, eliminatedOpponentIds grows as opponents broadcast their
  // own eliminations, and opponentCount is the match's starting roster size
  // (a snapshot, not live presence — see VersusApp) — once
  // eliminatedOpponentIds covers everyone, this client has outlasted the room.
  onEliminated?: () => void;
  eliminatedOpponentIds?: string[];
  opponentCount?: number;
  // Full match roster (same snapshot opponentCount is derived from), used to
  // seed a preview slot for every opponent from the moment the match starts
  // — opponentBoards below only gets an entry once that opponent's first
  // piece locks, so without this, previews would pop in one at a time as a
  // bigger lobby's players each place their first piece instead of all
  // being visible (empty) immediately.
  opponentIds?: string[];
  // Only used by the post-match "Rematch" button — keeps the room alive and
  // returns to the lobby's ready-up screen, unlike onMenu (full leave).
  onRematchMenu?: () => void;
  // Shared 7-bag RNG seed (from useOnlineRoom's matchSeed) so both players
  // see the identical piece sequence — see the mulberry32/generateBag setup.
  seed?: number;
  // Host-chosen room setting (from useOnlineRoom's matchStartingLevel),
  // defaulting to 1 — everyone in the match starts at this level instead of
  // always level 1, and the level-up-every-10-lines formula below is offset
  // from it rather than reset to it.
  startingLevel?: number;
  // Host-chosen room setting (from useOnlineRoom's matchLives), defaulting
  // to 1 — topping out with lives remaining soft-resets the board (like
  // sandbox's board-clear) instead of ending the match; only running out of
  // lives is a real elimination. See handleGameOver's versus branch.
  lives?: number;
  // Opponent board previews, rendered as small MiniBoard grids — one entry
  // per opponent, however many that is. Sent once per lock (see lockPiece)
  // AND periodically during play (see PREVIEW_BROADCAST_INTERVAL_MS in the
  // game loop), so previews track live movement/gravity, not just spawns.
  // pieceMatrix/pieceX/pieceY are the opponent's actual current piece shape
  // and position (already rotated), not just a type to re-derive a spawn
  // position from. livesRemaining is their current life count (see `lives`).
  onBoardUpdate?: (board: number[][], pieceMatrix: number[][], pieceX: number, pieceY: number, livesRemaining: number) => void;
  opponentBoards?: { guestId: string; board: number[][]; pieceMatrix: number[][]; pieceX: number; pieceY: number; livesRemaining: number }[];
  // Fired once on a win — VersusApp owns the actual session win counter
  // (displayed in OnlineLobby instead of here, since this component fully
  // remounts every match and the counter needs to survive that).
  onMatchWin?: () => void;
}

interface ScoreEntry {
  name: string;
  score: number;
  level: number;
  mode: string;
}

const MAX_LEADERBOARD = 8;
const SPRINT_GOAL = 40;
const BLITZ_TIME_LIMIT = 3 * 60 * 1000; // 3 minutes in milliseconds
// Versus-only: how often the game loop broadcasts this client's live board +
// active piece to opponents (see the `update()` loop and MiniBoard), on top
// of the existing once-per-lock broadcast. Frequent enough to read as
// "closely following" their actual play, throttled well below per-frame so
// it doesn't flood the Realtime channel.
const PREVIEW_BROADCAST_INTERVAL_MS = 200;
// Piece type (matches PIECES/COLORS indexing) paired with its rebindable
// action name — defaults to keys 1-7 in that same order (I, O, T, S, Z, J, L).
const SPAWN_HOTKEY_ACTIONS = [
  { type: 1, action: 'Spawn I' as const },
  { type: 2, action: 'Spawn O' as const },
  { type: 3, action: 'Spawn T' as const },
  { type: 4, action: 'Spawn S' as const },
  { type: 5, action: 'Spawn Z' as const },
  { type: 6, action: 'Spawn J' as const },
  { type: 7, action: 'Spawn L' as const },
];

// The board-level (non-piece) sandbox hotkeys, shown in their own small grid.
const SANDBOX_GENERAL_HOTKEY_ACTIONS = ['Clear Board', 'Toggle 0-G'] as const;

// Every sandbox-only action name (general + piece), rebindable the same way
// as the regular keybinds but kept out of the main Keybinds grid since they
// only do anything in standard/sandbox mode.
const SANDBOX_HOTKEY_ACTIONS = [
  ...SANDBOX_GENERAL_HOTKEY_ACTIONS,
  ...SPAWN_HOTKEY_ACTIONS.map((p) => p.action),
] as const;

// ==========================================
// 1. PURE ENGINE FUNCTIONS
// ==========================================

export const formatTime = (ms: number) => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = Math.floor(ms % 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

const calculateDropInterval = (level: number) => {
  const speed = Math.pow(0.8 - ((level - 1) * 0.007), level - 1) * 1000;
  return speed < 15 ? 0 : speed;
};

const WALL_KICKS: Record<string, {x: number, y: number}[]> = {
  '0-1': [{x:0,y:0}, {x:-1,y:0}, {x:-1,y:-1}, {x:0,y:2},  {x:-1,y:2}],
  '1-0': [{x:0,y:0}, {x:1,y:0},  {x:1,y:1},   {x:0,y:-2}, {x:1,y:-2}],
  '1-2': [{x:0,y:0}, {x:1,y:0},  {x:1,y:1},   {x:0,y:-2}, {x:1,y:-2}],
  '2-1': [{x:0,y:0}, {x:-1,y:0}, {x:-1,y:-1}, {x:0,y:2},  {x:-1,y:2}],
  '2-3': [{x:0,y:0}, {x:1,y:0},  {x:1,y:-1},  {x:0,y:2},  {x:1,y:2}],
  '3-2': [{x:0,y:0}, {x:-1,y:0}, {x:-1,y:1},  {x:0,y:-2}, {x:-1,y:-2}],
  '3-0': [{x:0,y:0}, {x:-1,y:0}, {x:-1,y:1},  {x:0,y:-2}, {x:-1,y:-2}],
  '0-3': [{x:0,y:0}, {x:1,y:0},  {x:1,y:-1},  {x:0,y:2},  {x:1,y:2}],
};

const I_WALL_KICKS: Record<string, {x: number, y: number}[]> = {
  '0-1': [{x:0,y:0}, {x:-2,y:0}, {x:1,y:0},  {x:-2,y:1},  {x:1,y:-2}],
  '1-0': [{x:0,y:0}, {x:2,y:0},  {x:-1,y:0}, {x:2,y:-1},  {x:-1,y:2}],
  '1-2': [{x:0,y:0}, {x:-1,y:0}, {x:2,y:0},  {x:-1,y:-2}, {x:2,y:1}],
  '2-1': [{x:0,y:0}, {x:1,y:0},  {x:-2,y:0}, {x:1,y:2},   {x:-2,y:-1}],
  '2-3': [{x:0,y:0}, {x:2,y:0},  {x:-1,y:0}, {x:2,y:-1},  {x:-1,y:2}],
  '3-2': [{x:0,y:0}, {x:-2,y:0}, {x:1,y:0},  {x:-2,y:1},  {x:1,y:-2}],
  '3-0': [{x:0,y:0}, {x:1,y:0},  {x:-2,y:0}, {x:1,y:2},   {x:-2,y:-1}],
  '0-3': [{x:0,y:0}, {x:-1,y:0}, {x:2,y:0},  {x:-1,y:-2}, {x:2,y:1}],
};

const KICKS_180 = [{x:0, y:0}, {x:0, y:-1}, {x:-1, y:0}, {x:1, y:0}, {x:0, y:1}];

// Deterministic PRNG (mulberry32) — used only in versus mode, seeded
// identically on both clients, so both boards see the same piece sequence.
// Solo modes keep using plain Math.random() via generateBag's default.
const mulberry32 = (seed: number) => {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const generateBag = (rand: () => number = Math.random) => {
  const bag = [1, 2, 3, 4, 5, 6, 7];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
};

const createMatrix = (w: number, h: number) =>
  Array.from({ length: h }, () => Array(w).fill(0));

// Shared placeholder for an opponent's preview before their board-snapshot
// broadcast has arrived — MiniBoard only reads it, never mutates it, so one
// shared instance is safe across every placeholder slot.
const EMPTY_MINI_BOARD = createMatrix(COLS, ROWS);

const collide = (boardMatrix: number[][], playerPiece: { matrix: number[][], pos: { x: number, y: number } }) => {
  const m = playerPiece.matrix;
  const o = playerPiece.pos;
  for (let y = 0; y < m.length; ++y) {
    for (let x = 0; x < m[y].length; ++x) {
      if (m[y][x] !== 0 && (boardMatrix[y + o.y] && boardMatrix[y + o.y][x + o.x]) !== 0) return true;
    }
  }
  return false;
};

const merge = (boardMatrix: number[][], playerPiece: { matrix: number[][], pos: { x: number, y: number } }) => {
  playerPiece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) boardMatrix[y + playerPiece.pos.y][x + playerPiece.pos.x] = value;
    });
  });
};

// Versus-mode garbage: attack size per clear (T-Spin Single/Double/Triple,
// then Single/Double/Triple/Tetris), a combo bonus table on top, and a row
// insertion helper — all pure so lockPiece can call straight into them.
const GARBAGE_VALUE = 8;
const COMBO_ATTACK = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

const getBaseAttack = (linesCleared: number, tSpin: boolean): number => {
  if (tSpin) return linesCleared === 1 ? 2 : linesCleared === 2 ? 4 : linesCleared === 3 ? 6 : 0;
  return linesCleared === 2 ? 1 : linesCleared === 3 ? 2 : linesCleared === 4 ? 4 : 0;
};

const insertGarbageRows = (boardMatrix: number[][], count: number) => {
  const gapCol = Math.floor(Math.random() * COLS);
  for (let i = 0; i < count; i++) {
    boardMatrix.shift();
    const row = new Array(COLS).fill(GARBAGE_VALUE);
    row[gapCol] = 0;
    boardMatrix.push(row);
  }
};

const rotate = (matrix: number[][], dir: number) => {
  const rotated = matrix.map((_, index) => matrix.map(col => col[index]));
  if (dir > 0) return rotated.map(row => row.reverse());
  return rotated.reverse();
};

const MiniPiece = ({ type }: { type: number | null }) => {
  if (!type) return null;
  const matrix = PIECES[type];
  return (
    <div style={{ display: 'grid', gap: '1px', gridTemplateColumns: `repeat(${matrix[0].length}, 1fr)` }}>
      {matrix.map((row, y) => row.map((val, x) => (
        <div
          key={`${x}-${y}`}
          style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: val ? COLORS[val] : 'transparent', boxShadow: val ? `0 0 8px ${COLORS[val]}` : 'none' }}
        />
      )))}
    </div>
  );
};

// Compact opponent-board preview — same small-DOM-grid approach as MiniPiece
// above rather than a canvas, since there can be several of these at once (up
// to MAX_ROOM_SIZE opponents) and they only need to read as a rough shape,
// not render crisp/animated like the main board. `cellSize` is a literal
// pixel value (not a multiplier) so callers can solve for an exact overall
// board size. `gap`/`padding` default to scaling with cellSize (matching the
// original fixed-3px version's proportions, for the compact side-column
// case), but the 1v1 adjacent board below overrides both to small fixed
// values instead — a gap/padding that scales with cellSize adds a bigger
// fraction of overhead to the (shorter) width than the (taller) height,
// since COLS and ROWS differ, which skews the rendered aspect ratio away
// from the main board's own COLS:ROWS proportions the bigger cellSize gets;
// fixed overhead keeps that skew negligible so "90% of the main board" is
// accurate in both dimensions, not just the one solved for.
//
// `pieceMatrix`/`pieceX`/`pieceY`, when given, overlay the opponent's actual
// current piece (already rotated, real position) on top of the locked
// board — this is real data now, not a guess: the game loop broadcasts it
// on every lock AND periodically during play (see
// PREVIEW_BROADCAST_INTERVAL_MS), so the preview tracks live movement and
// gravity instead of freezing at spawn between locks or faking a fall
// locally. No animation/interpolation here — just render whatever the last
// broadcast said, the same way `board` itself is rendered.
//
// `eliminated` dims the board and stamps "ELIMINATED" over it — covers both
// topping out and disconnecting, since useOnlineRoom already folds a dropped
// connection into eliminatedGuestIds (see CLAUDE.md).
const MiniBoard = ({ board, cellSize = 3, gap = cellSize / 3, padding = cellSize, pieceMatrix, pieceX = 0, pieceY = 0, eliminated }: { board: number[][]; cellSize?: number; gap?: number; padding?: number; pieceMatrix?: number[][]; pieceX?: number; pieceY?: number; eliminated?: boolean }) => {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gap: `${gap}px`, gridTemplateColumns: `repeat(${COLS}, 1fr)`, backgroundColor: 'rgba(0,0,0,0.6)', padding: `${padding}px`, borderRadius: `${padding}px`, border: '1px solid rgba(255,255,255,0.1)', opacity: eliminated ? 0.35 : 1 }}>
        {board.map((row, y) => row.map((val, x) => {
          let cellVal = val;
          if (pieceMatrix) {
            const px = x - pieceX;
            const py = y - pieceY;
            if (py >= 0 && py < pieceMatrix.length && px >= 0 && px < pieceMatrix[0].length && pieceMatrix[py][px]) {
              cellVal = pieceMatrix[py][px];
            }
          }
          return (
            <div
              key={`${x}-${y}`}
              style={{ width: `${cellSize}px`, height: `${cellSize}px`, backgroundColor: cellVal ? COLORS[cellVal] : 'rgba(255,255,255,0.04)' }}
            />
          );
        }))}
      </div>
      {eliminated && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `${Math.max(padding, 4)}px` }}>
          <span style={{ fontSize: `${Math.max(cellSize * 1.4, 8)}px`, color: '#f87171', fontWeight: 'bold', letterSpacing: '0.08em', textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.9)', textTransform: 'uppercase', lineHeight: 1.2 }}>
            Eliminated
          </span>
        </div>
      )}
    </div>
  );
};

// On-screen control used only on mobile, where there's no keyboard to drive
// the same move/rotate/drop/hold actions the desktop build binds to keydown.
const TouchControlButton = ({
  label,
  ariaLabel,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
}: {
  label: string;
  ariaLabel: string;
  onClick?: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onPointerCancel?: () => void;
}) => (
  <button
    type="button"
    aria-label={ariaLabel}
    onClick={onClick}
    onPointerDown={onPointerDown ? (e) => { e.preventDefault(); onPointerDown(); } : undefined}
    onPointerUp={onPointerUp}
    onPointerLeave={onPointerLeave}
    onPointerCancel={onPointerCancel}
    style={{
      flex: 1,
      minWidth: 0,
      padding: '14px 0',
      fontSize: '1.1rem',
      fontWeight: 'bold',
      borderRadius: '10px',
      border: '1px solid var(--tt-accent)',
      backgroundColor: 'color-mix(in srgb, var(--tt-accent) 25%, transparent)',
      color: 'var(--tt-accent)',
      touchAction: 'manipulation',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);


// ==========================================
// 2. MAIN REACT COMPONENT
// ==========================================

export default function TetrisGame({ mode, onMenu, onAttack, incomingGarbage, onEliminated, eliminatedOpponentIds, opponentCount, opponentIds, onRematchMenu, seed, startingLevel, lives, onBoardUpdate, opponentBoards, onMatchWin }: TetrisGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeDisplayRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<number>(0);
  
  const board = useRef<number[][]>(createMatrix(COLS, ROWS));
  const dropCounter = useRef(0);
  const dropInterval = useRef(calculateDropInterval(startingLevel ?? 1));
  const lastTime = useRef(0);
  
  const gameStartTimeRef = useRef(0);
  const elapsedTimeRef = useRef(0);

  const isLockingRef = useRef(false);
  const lockTimerRef = useRef(0);
  const lastHardDropTimeRef = useRef(0);
  
  const lockResetsRef = useRef(0);
  const lowestYRef = useRef(0);

  const scoreRef = useRef(0); 
  const linesRef = useRef(0);
  const levelRef = useRef(startingLevel ?? 1);
  const lastMoveRef = useRef<'move' | 'rotate' | 'drop' | null>(null);
  const b2bRef = useRef(false);
  const comboRef = useRef(-1);
  const actionTextRef = useRef({ text: '', timer: 0 });

  // Seeded only in versus mode (once the room's matchSeed prop arrives) so
  // both players' bags are identical; solo modes fall through to Math.random.
  const rngRef = useRef<() => number>(mode === 'versus' && seed != null ? mulberry32(seed) : Math.random);
  const nextPiecesRef = useRef<number[]>([...generateBag(rngRef.current), ...generateBag(rngRef.current)]);
  // Captured once, synchronously, on first render — before playerReset()
  // (which runs in the mount effect below) ever shifts nextPiecesRef. Since
  // versus mode's bag is seeded identically for everyone, this is also every
  // opponent's first piece, not just this client's — used as the preview
  // placeholder's active piece before an opponent's own first lock actually
  // broadcasts one (see previewBoards below).
  const initialPieceTypeRef = useRef<number>(nextPiecesRef.current[0]);
  const holdPieceRef = useRef<number | null>(null);
  const canHoldRef = useRef(true);

  const player = useRef({ pos: { x: 0, y: 0 }, matrix: [] as number[][], type: 0, rotState: 0 });
  
  const [gameState, setGameState] = useState<'COUNTDOWN' | 'PLAYING' | 'NAME_ENTRY' | 'LEADERBOARD'>('COUNTDOWN');
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const [countdownText, setCountdownText] = useState<number | string>(3);

  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [showControls, setShowControls] = useState(false);
  const showControlsRef = useRef(false);
  // Which content the pause overlay shows — the regular keybinds/handling
  // settings, or (sandbox mode only) the gravity/board tools. Both share the
  // same overlay + pause mechanism, just different buttons open different tabs.
  const [settingsTab, setSettingsTab] = useState<'controls' | 'sandbox'>('controls');
  // True gravity-off: the piece never auto-falls until soft/hard-dropped.
  // Distinct from the gravity slider's fast end (which still ticks, just
  // near-instantly) — this sets dropInterval to Infinity so it never ticks.
  const [zeroGravity, setZeroGravity] = useState(false);
  const zeroGravityRef = useRef(false);
  // Versus-only: which end state the match hit (topping out, or outlasting
  // every other opponent), read by the LEADERBOARD-state overlay below.
  const [versusOutcome, setVersusOutcome] = useState<'won-last-standing' | 'lost-topout'>('lost-topout');
  // Versus-only extra-life count (host-set via roomSettings.lives, default
  // 1). Ref is the source of truth read synchronously inside handleGameOver;
  // livesDisplay just mirrors it into the HUD, same split as
  // pendingGarbageRef/pendingGarbageDisplay above.
  const livesRemainingRef = useRef(lives ?? 1);
  const [livesDisplay, setLivesDisplay] = useState(lives ?? 1);
  // Garbage queued from incoming broadcasts, netted against this client's own
  // attack and inserted into the board on the next piece lock (see lockPiece).
  const pendingGarbageRef = useRef(0);
  // Mirrors pendingGarbageRef for the garbage-bar UI — the ref stays the
  // source of truth read inside the game loop, this just triggers a render.
  const [pendingGarbageDisplay, setPendingGarbageDisplay] = useState(0);
  // Live running total for the HUD.
  const [linesSent, setLinesSent] = useState(0);
  // PPS/APM (Sprint, Blitz, Versus) and attack/min (Versus only) — raw counts
  // live in refs (read from the mount-only keydown/touch closures, same
  // reasoning as canAct/toggleZeroGravity below, and needed synchronously to
  // compute attack/min in the same tick a new attack is sent), the displayed
  // rate is recomputed into state each time a piece locks or an action fires
  // rather than ticking every frame.
  const piecesLockedRef = useRef(0);
  const actionsRef = useRef(0);
  const linesSentRef = useRef(0);
  const [pps, setPps] = useState(0);
  const [apm, setApm] = useState(0);
  const [attackPerMin, setAttackPerMin] = useState(0);
  // Guards against a local game-over and an opponent-result broadcast both
  // trying to end the match.
  const matchEndedRef = useRef(false);
  // Throttles the live-position broadcast added to the game loop below —
  // see PREVIEW_BROADCAST_INTERVAL_MS.
  const lastPreviewBroadcastRef = useRef(0);

  // Incoming garbage just accumulates here — it's netted against this
  // client's own attack and actually inserted into the board on the next
  // piece lock (see lockPiece), not on arrival.
  useEffect(() => {
    if (mode !== 'versus' || !incomingGarbage) return;
    pendingGarbageRef.current += incomingGarbage.amount;
    setPendingGarbageDisplay(pendingGarbageRef.current);
  }, [mode, incomingGarbage]);

  // Last-player-standing: once every opponent in the starting roster has
  // broadcast their own elimination, this client has outlasted the room —
  // independent of anything happening locally, hence matchEndedRef to stop
  // this double-firing against a local handleGameOver call already in flight.
  useEffect(() => {
    if (mode !== 'versus' || matchEndedRef.current) return;
    if (!opponentCount || (eliminatedOpponentIds?.length ?? 0) < opponentCount) return;
    matchEndedRef.current = true;
    scoreRef.current = elapsedTimeRef.current;
    setVersusOutcome('won-last-standing');
    setGameState('LEADERBOARD');
    onMatchWin?.();
    syncUi();
  }, [mode, eliminatedOpponentIds, opponentCount]);

  const [listeningAction, setListeningAction] = useState<string | null>(null);
  const listeningActionRef = useRef<string | null>(null);
  
  const [tuning, setTuning] = useState({ das: 170, arr: 30, dcd: 0, sdf: 40 });
  const tuningRef = useRef(tuning);
  
  const [controls, setControls] = useState({
    'Left': 'ArrowLeft', 'Right': 'ArrowRight', 'Down': 'ArrowDown',
    'Rotate CW': 'ArrowUp', 'Rotate CCW': 'z', 'Rotate 180': 'a',
    'Hard Drop': ' ', 'Hold': 'c',
    // Sandbox-only hotkeys — rebindable the same way as the rest, but kept
    // out of the main Keybinds grid (see SANDBOX_HOTKEY_ACTIONS) since they
    // only do anything in standard/sandbox mode.
    'Clear Board': 'r', 'Toggle 0-G': 'g',
    'Spawn I': '1', 'Spawn O': '2', 'Spawn T': '3', 'Spawn S': '4',
    'Spawn Z': '5', 'Spawn J': '6', 'Spawn L': '7',
  });
  const controlsRef = useRef(controls);

  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Drives the mobile-only layout + on-screen touch controls below. Desktop
  // rendering is untouched — every mobile-specific style is a ternary that
  // falls back to the original desktop value when this is false.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const savedTuning = localStorage.getItem('tetrisTuning');
    const savedControls = localStorage.getItem('tetrisControls');
    
    if (savedTuning) {
      try { setTuning(JSON.parse(savedTuning)); } catch (e) { console.error('Failed to parse tuning'); }
    }
    if (savedControls) {
      // Merge onto the defaults rather than replacing outright — a saved
      // object from before the sandbox hotkeys existed wouldn't have those
      // keys, and indexing a missing key later (e.g. `.replace()` on it in
      // the Hotkeys UI) would throw.
      try { setControls(prev => ({ ...prev, ...JSON.parse(savedControls) })); } catch (e) { console.error('Failed to parse controls'); }
    }
    setSettingsLoaded(true);
  }, []);

  useEffect(() => { 
    tuningRef.current = tuning; 
    if (settingsLoaded) {
      localStorage.setItem('tetrisTuning', JSON.stringify(tuning));
    }
  }, [tuning, settingsLoaded]);

  useEffect(() => { 
    controlsRef.current = controls; 
    if (settingsLoaded) {
      localStorage.setItem('tetrisControls', JSON.stringify(controls));
    }
  }, [controls, settingsLoaded]);

  const keysDown = useRef({ left: false, right: false, down: false, hardDrop: false });
  const dasTimers = useRef({ das: 0, arr: 0, dcd: 0 });

  const [uiState, setUiState] = useState({ 
    score: 0, lines: 0, level: 1, next: nextPiecesRef.current.slice(0, 5), hold: null as number | null, actionText: '' 
  });

  const syncUi = () => {
    setUiState({ 
      score: scoreRef.current, lines: linesRef.current, level: levelRef.current, 
      next: nextPiecesRef.current.slice(0, 5), hold: holdPieceRef.current, actionText: actionTextRef.current.text 
    });
  };

  useEffect(() => {
    if (gameState === 'COUNTDOWN') {
      setCountdownText(3);
      let count = 3;
      const interval = setInterval(() => {
        count -= 1;
        if (count > 0) {
          setCountdownText(count);
        } else if (count === 0) {
          setCountdownText('GO!');
        } else {
          clearInterval(interval);
          gameStartTimeRef.current = 0; 
          setGameState('PLAYING');
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState]);

  const fetchLeaderboard = async () => {
    try {
      const { data, error } = await supabase
        .from('tetris_scores')
        .select('name, score, level, mode')
        .eq('mode', mode) 
        .order('score', { ascending: mode === 'sprint' }) 
        .limit(MAX_LEADERBOARD);

      if (error) {
        console.error('Supabase fetch error:', error.message);
      } else if (data) {
        setLeaderboard(data);
      }
    } catch (err) {
      console.error('Failed to fetch scores:', err);
    }
  };

  useEffect(() => {
    // Sandbox (standard) mode doesn't score or compete, and versus matches
    // aren't ranked against the solo leaderboard either — neither has one to
    // show or fetch.
    if (mode !== 'standard' && mode !== 'versus') fetchLeaderboard();
  }, [mode]);

  const saveHighScore = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const name = nameInput.trim() || 'AAA';
    const score = Math.floor(scoreRef.current);
    const level = levelRef.current;

    const newEntry: ScoreEntry = { name, score, level, mode };

    const updatedLocal = [...leaderboard, newEntry]
      .sort((a, b) => mode === 'sprint' ? a.score - b.score : b.score - a.score)
      .slice(0, MAX_LEADERBOARD);

    setLeaderboard(updatedLocal);
    setGameState('LEADERBOARD');

    try {
      const { error } = await supabase
        .from('tetris_scores')
        .insert([{ name, score, level, mode }]);

      if (error) {
        console.error('Supabase insert error:', error.message);
      } else {
        await fetchLeaderboard(); 
      }
    } catch (err) {
      console.error('Failed to submit score:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isTSpin = () => {
    if (player.current.type !== 3) return false;
    if (lastMoveRef.current !== 'rotate') return false;

    let corners = 0;
    const { x, y } = player.current.pos;
    const checkCorner = (cx: number, cy: number) => {
      if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board.current[cy][cx] !== 0)) corners++;
    };
    checkCorner(x, y); checkCorner(x + 2, y); checkCorner(x, y + 2); checkCorner(x + 2, y + 2);
    return corners >= 3;
  };

  const handleGameOver = (isWin: boolean) => {
    if (mode === 'standard') {
      // Sandbox mode never really "ends" — topping out just clears the
      // board and play continues immediately, with no leaderboard/name-entry
      // interruption. Gravity/level stays at whatever the player dialed in.
      board.current = createMatrix(COLS, ROWS);
      comboRef.current = -1;
      b2bRef.current = false;
      dropCounter.current = 0;
      // Restart the practice stopwatch — set to 0 here so update() reinitializes
      // it from the current frame's time next tick; the direct innerText write
      // avoids a one-frame flash of the old elapsed value in the meantime.
      gameStartTimeRef.current = 0;
      if (timeDisplayRef.current) timeDisplayRef.current.innerText = '00:00.000';
      actionTextRef.current = { text: 'Board Cleared', timer: 1200 };
      playerReset();
      syncUi();
      return;
    }

    if (mode === 'versus') {
      // Only ever reached via topout now — versus has no line-clear win
      // path (see the removed SPRINT_GOAL check in lockPiece), so isWin is
      // always false here; last-player-standing wins are decided separately
      // by the eliminatedOpponentIds effect above instead.
      if (matchEndedRef.current) return;

      if (livesRemainingRef.current > 1) {
        // Still have a life left — soft-reset like sandbox's board-clear
        // above, not a real elimination: the match clock, piece queue,
        // lines-sent/received totals, and win-condition eligibility all
        // keep running uninterrupted, only the board and combo/back-to-back
        // state clear.
        livesRemainingRef.current -= 1;
        setLivesDisplay(livesRemainingRef.current);
        board.current = createMatrix(COLS, ROWS);
        comboRef.current = -1;
        b2bRef.current = false;
        dropCounter.current = 0;
        actionTextRef.current = {
          text: `TOP OUT\n${livesRemainingRef.current} ${livesRemainingRef.current === 1 ? 'LIFE' : 'LIVES'} LEFT`,
          timer: 1800,
        };
        // Broadcast immediately (same peek-before-reset convention as the
        // normal lockPiece call site) rather than waiting for the next real
        // lock — otherwise an opponent's preview would keep showing the
        // stale, topped-out-looking board and old life count for however
        // long it takes this player to place their next piece. Same spawn
        // math as playerReset() itself, computed here since it hasn't run yet.
        {
          const nextMatrix = PIECES[nextPiecesRef.current[0]];
          const nextX = Math.floor(COLS / 2) - Math.floor(nextMatrix[0].length / 2);
          onBoardUpdate?.(board.current, nextMatrix, nextX, 0, livesRemainingRef.current);
        }
        playerReset();
        syncUi();
        return;
      }

      matchEndedRef.current = true;
      scoreRef.current = elapsedTimeRef.current;
      setVersusOutcome('lost-topout');
      setGameState('LEADERBOARD');
      onEliminated?.();
      syncUi();
      return;
    }

    const currentScore = mode === 'sprint' ? elapsedTimeRef.current : scoreRef.current;
    scoreRef.current = currentScore;

    if (mode === 'sprint' && !isWin) {
      setGameState('LEADERBOARD');
      syncUi();
      return;
    }

    const isHighScore = leaderboard.length < MAX_LEADERBOARD || 
      (mode === 'sprint' 
        ? currentScore < (leaderboard[leaderboard.length - 1]?.score || Infinity)
        : currentScore > (leaderboard[leaderboard.length - 1]?.score || 0));
    
    if (isHighScore && currentScore > 0) {
      setGameState('NAME_ENTRY');
    } else {
      setGameState('LEADERBOARD');
    }
    syncUi();
  };

  const playerReset = () => {
    player.current.type = nextPiecesRef.current.shift()!;
    if (nextPiecesRef.current.length <= 5) nextPiecesRef.current.push(...generateBag(rngRef.current));
    
    player.current.matrix = PIECES[player.current.type];
    player.current.pos.y = 0;
    player.current.pos.x = Math.floor(COLS / 2) - Math.floor(player.current.matrix[0].length / 2);
    player.current.rotState = 0; 
    
    lowestYRef.current = player.current.pos.y;
    lockResetsRef.current = 0;

    canHoldRef.current = true;
    isLockingRef.current = false;
    lockTimerRef.current = 0;
    lastMoveRef.current = null;
    
    if (keysDown.current.left || keysDown.current.right) dasTimers.current.dcd = tuningRef.current.dcd;
    syncUi();

    if (collide(board.current, player.current)) {
      handleGameOver(false);
    }
  };

  const restartGame = () => {
    board.current = createMatrix(COLS, ROWS);
    scoreRef.current = 0; linesRef.current = 0; levelRef.current = 1; holdPieceRef.current = null; 
    dropInterval.current = calculateDropInterval(1);
    
    comboRef.current = -1; b2bRef.current = false; actionTextRef.current = {text: '', timer: 0};
    nextPiecesRef.current = [...generateBag(rngRef.current), ...generateBag(rngRef.current)];
    
    player.current.type = nextPiecesRef.current.shift()!;
    player.current.matrix = PIECES[player.current.type];
    player.current.pos.y = 0;
    player.current.pos.x = Math.floor(COLS / 2) - Math.floor(player.current.matrix[0].length / 2);
    player.current.rotState = 0;
    
    lowestYRef.current = player.current.pos.y;
    lockResetsRef.current = 0;

    gameStartTimeRef.current = 0;
    elapsedTimeRef.current = 0;
    piecesLockedRef.current = 0;
    actionsRef.current = 0;
    setPps(0);
    setApm(0);

    if (timeDisplayRef.current) {
        if (mode === 'blitz') timeDisplayRef.current.innerText = '03:00.000';
        else if (mode === 'sprint') timeDisplayRef.current.innerText = '00:00.000';
    }

    setNameInput('');
    setGameState('COUNTDOWN');
    syncUi();
  };

  const lockPiece = () => {
    countPiece();
    merge(board.current, player.current);
    const tSpin = isTSpin();
    
    let linesCleared = 0;
    outer: for (let y = board.current.length - 1; y >= 0; --y) {
      for (let x = 0; x < board.current[y].length; ++x) {
        if (board.current[y][x] === 0) continue outer;
      }
      const row = board.current.splice(y, 1)[0].fill(0);
      board.current.unshift(row);
      ++y; linesCleared++;
    }

    let attack = mode === 'versus' ? getBaseAttack(linesCleared, tSpin) : 0;

    if (linesCleared > 0) {
      comboRef.current++;
      let baseScore = 0;
      let isDifficult = false;
      let actionStr = '';

      if (tSpin) {
        isDifficult = true;
        if (linesCleared === 1) { baseScore = 800; actionStr = 'T-Spin Single'; }
        else if (linesCleared === 2) { baseScore = 1200; actionStr = 'T-Spin Double'; }
        else if (linesCleared === 3) { baseScore = 1600; actionStr = 'T-Spin Triple'; }
      } else {
        if (linesCleared === 1) { baseScore = 100; }
        else if (linesCleared === 2) { baseScore = 300; }
        else if (linesCleared === 3) { baseScore = 500; }
        else if (linesCleared === 4) { baseScore = 800; actionStr = 'Tetris'; isDifficult = true; }
      }

      let calculatedScore = baseScore * levelRef.current;
      
      if (isDifficult) {
        if (b2bRef.current) {
          calculatedScore = Math.floor(calculatedScore * 1.5);
          actionStr = 'B2B ' + actionStr;
          if (mode === 'versus') attack += 1;
        }
        b2bRef.current = true;
      } else {
        b2bRef.current = false;
      }

      if (comboRef.current > 0) {
        calculatedScore += 50 * comboRef.current * levelRef.current;
        actionStr += `\n${comboRef.current} Combo`;
        if (mode === 'versus') attack += COMBO_ATTACK[Math.min(comboRef.current, COMBO_ATTACK.length - 1)];
      }

      if (mode === 'blitz' || mode === 'standard') {
        scoreRef.current += calculatedScore;
      }

      linesRef.current += linesCleared;
      // Sandbox mode's gravity is whatever the player dialed in via the
      // settings panel — it shouldn't creep up on its own from lines cleared.
      // Offset from startingLevel (1 outside versus, or when the host left it
      // at the default) rather than reset to a flat +1, so a host-chosen
      // starting level keeps climbing from there instead of being clobbered
      // by the first line clear.
      if (mode !== 'standard') {
        levelRef.current = (startingLevel ?? 1) + Math.floor(linesRef.current / 10);
        dropInterval.current = calculateDropInterval(levelRef.current);
      }

      if (actionStr) actionTextRef.current = { text: actionStr, timer: 2000 };

      if (mode === 'sprint' && linesRef.current >= SPRINT_GOAL) {
         handleGameOver(true);
         return;
      }

    } else {
      comboRef.current = -1;
      if (tSpin) {
        if (mode === 'blitz' || mode === 'standard') scoreRef.current += 400 * levelRef.current;
        actionTextRef.current = { text: 'T-SPIN', timer: 1500 };
      }
    }

    if (mode === 'versus') {
      const cancelled = Math.min(attack, pendingGarbageRef.current);
      pendingGarbageRef.current -= cancelled;
      const netAttack = attack - cancelled;
      if (netAttack > 0) {
        onAttack?.(netAttack);
        linesSentRef.current += netAttack;
        setLinesSent(linesSentRef.current);
        const min = elapsedTimeRef.current / 60000;
        setAttackPerMin(min > 0 ? linesSentRef.current / min : 0);
      }
      if (pendingGarbageRef.current > 0) {
        insertGarbageRows(board.current, pendingGarbageRef.current);
        pendingGarbageRef.current = 0;
      }
      setPendingGarbageDisplay(pendingGarbageRef.current);
      // nextPiecesRef[0] here (not player.current.type) — playerReset() below
      // hasn't shifted the queue yet at this point, so this is exactly the
      // piece about to spawn as the new active piece, without needing to
      // reorder around playerReset()'s own game-over collision check. Same
      // spawn math as playerReset() itself, computed here since it hasn't run yet.
      {
        const nextMatrix = PIECES[nextPiecesRef.current[0]];
        const nextX = Math.floor(COLS / 2) - Math.floor(nextMatrix[0].length / 2);
        onBoardUpdate?.(board.current, nextMatrix, nextX, 0, livesRemainingRef.current);
      }
    }

    playerReset();
    dropCounter.current = 0;
  };

  const getGhostY = () => {
    let ghostY = player.current.pos.y;
    while (!collide(board.current, { matrix: player.current.matrix, pos: { x: player.current.pos.x, y: ghostY } })) {
      ghostY++;
    }
    return ghostY - 1;
  };

  const playerDrop = (drops = 1, isSoftDrop = false) => {
    let droppedThisFrame = 0;
    for (let i = 0; i < drops; i++) {
      player.current.pos.y++;
      if (collide(board.current, player.current)) {
        player.current.pos.y--; 
        dropCounter.current = 0; 
        break;
      }
      droppedThisFrame++;
    }
    if (isSoftDrop && droppedThisFrame > 0 && (mode === 'blitz' || mode === 'standard')) {
      scoreRef.current += droppedThisFrame;
      syncUi();
    }
  };

  const hardDrop = () => {
    const now = performance.now();
    if (now - lastHardDropTimeRef.current < 100) return;
    lastHardDropTimeRef.current = now;

    const dist = getGhostY() - player.current.pos.y;
    if (mode === 'blitz' || mode === 'standard') scoreRef.current += dist * 2;
    player.current.pos.y += dist; 
    lastMoveRef.current = 'drop';
    lockPiece(); 
  };

  const playerMove = (offset: number) => {
    player.current.pos.x += offset;
    if (collide(board.current, player.current)) {
      player.current.pos.x -= offset;
      return false; 
    } else {
      lastMoveRef.current = 'move';
      if (isLockingRef.current) {
        if (lockResetsRef.current < 7) {
          lockTimerRef.current = 0;
          lockResetsRef.current++;
        }
      }
      return true; 
    }
  };

  const playerRotate = (dir: number) => {
    const originalMatrix = player.current.matrix;
    const originalPos = { ...player.current.pos };
    const originalRotState = player.current.rotState;

    let nextState = originalRotState;
    if (dir === 1) nextState = (originalRotState + 1) % 4; 
    else if (dir === -1) nextState = (originalRotState + 3) % 4; 
    else if (dir === 2) nextState = (originalRotState + 2) % 4; 

    if (dir === 2) {
      player.current.matrix = rotate(rotate(player.current.matrix, 1), 1);
    } else {
      player.current.matrix = rotate(player.current.matrix, dir);
    }

    if (player.current.matrix.length === 2) {
       if (!collide(board.current, player.current)) {
           player.current.rotState = nextState;
           lastMoveRef.current = 'rotate';
           if (isLockingRef.current) {
             if (lockResetsRef.current < 7) {
               lockTimerRef.current = 0;
               lockResetsRef.current++;
             }
           }
       } else {
           player.current.matrix = originalMatrix;
       }
       return;
    }

    let kicks = [{x: 0, y: 0}];
    if (dir === 2) {
        kicks = KICKS_180;
    } else {
        const key = `${originalRotState}-${nextState}`;
        if (player.current.matrix.length === 4) {
           kicks = I_WALL_KICKS[key] || [{x: 0, y: 0}];
        } else {
           kicks = WALL_KICKS[key] || [{x: 0, y: 0}];
        }
    }

    for (let i = 0; i < kicks.length; i++) {
        player.current.pos.x = originalPos.x + kicks[i].x;
        player.current.pos.y = originalPos.y + kicks[i].y;
        
        if (!collide(board.current, player.current)) {
            player.current.rotState = nextState;
            lastMoveRef.current = 'rotate';
            if (isLockingRef.current) {
              if (lockResetsRef.current < 7) {
                lockTimerRef.current = 0;
                lockResetsRef.current++;
              }
            }
            return;
        }
    }

    player.current.matrix = originalMatrix;
    player.current.pos = originalPos;
  };

  const holdPiece = () => {
    if (!canHoldRef.current) return;
    if (holdPieceRef.current === null) {
      holdPieceRef.current = player.current.type; playerReset();
    } else {
      const temp = player.current.type; player.current.type = holdPieceRef.current; player.current.matrix = PIECES[player.current.type];
      holdPieceRef.current = temp; player.current.pos.y = 0; player.current.pos.x = Math.floor(COLS / 2) - Math.floor(player.current.matrix[0].length / 2);
      player.current.rotState = 0; 
      
      lowestYRef.current = player.current.pos.y;
      lockResetsRef.current = 0;

      canHoldRef.current = false; 
      isLockingRef.current = false;
      lockTimerRef.current = 0;
      lastMoveRef.current = null;
      if (keysDown.current.left || keysDown.current.right) dasTimers.current.dcd = tuningRef.current.dcd;
      syncUi();
    }
  };

  // Sandbox-only: forces the currently falling piece to become a specific
  // type, for practicing a setup that needs a particular piece right now.
  // Doesn't touch the next-piece queue, so the upcoming bag order is
  // unaffected — only this one piece is overridden.
  const spawnSandboxPiece = (type: number) => {
    if (mode !== 'standard') return;
    if (gameStateRef.current !== 'PLAYING') return;

    const matrix = PIECES[type];
    const pos = { x: Math.floor(COLS / 2) - Math.floor(matrix[0].length / 2), y: 0 };
    if (collide(board.current, { matrix, pos })) return; // no room to force-spawn right now

    player.current.type = type;
    player.current.matrix = matrix;
    player.current.pos = pos;
    player.current.rotState = 0;

    lowestYRef.current = player.current.pos.y;
    lockResetsRef.current = 0;
    dropCounter.current = 0;

    canHoldRef.current = true;
    isLockingRef.current = false;
    lockTimerRef.current = 0;
    lastMoveRef.current = null;
    syncUi();
  };

  // Sandbox-only: wipes the board on demand, reusing handleGameOver's
  // standard-mode branch (auto-clear-and-continue) instead of duplicating it.
  const clearSandboxBoard = () => handleGameOver(true);

  // Opens the pause overlay on a specific tab, or closes it if that same tab
  // is already showing — each of the two Left Panel buttons (Settings /
  // Sandbox) calls this with its own tab, so they act as independent toggles
  // that share one underlying pause overlay.
  const openPanel = (tab: 'controls' | 'sandbox') => {
    if (gameState === 'COUNTDOWN') return;
    if (showControlsRef.current && settingsTab === tab) {
      showControlsRef.current = false;
      setShowControls(false);
      isPausedRef.current = false;
      setIsPaused(false);
    } else {
      setSettingsTab(tab);
      showControlsRef.current = true;
      setShowControls(true);
      isPausedRef.current = true;
      setIsPaused(true);
    }
  };

  // Toggles true zero-gravity: dropInterval becomes Infinity so the drop
  // timer (dropCounter > dropInterval) can never trip — the piece only moves
  // down via soft/hard drop. Turning it off restores the slider's level.
  //
  // Reads zeroGravityRef (not the zeroGravity state var) because this
  // function is called from handleKeyDown, which lives inside a
  // mount-only useEffect and therefore only ever sees the very first
  // render's closure. Reading state directly there would freeze `next` at
  // whatever it was on mount — the ref is a mutable box every closure reads
  // fresh, so it stays correct no matter how stale the calling closure is.
  const toggleZeroGravity = () => {
    const next = !zeroGravityRef.current;
    setZeroGravity(next);
    zeroGravityRef.current = next;
    dropInterval.current = next ? Infinity : calculateDropInterval(levelRef.current);
  };

  // Mirrors the guard at the top of handleKeyDown, so on-screen touch
  // buttons can't act while paused, in a menu, or before countdown ends.
  const canAct = () => gameStateRef.current === 'PLAYING' && !isPausedRef.current && !showControlsRef.current;

  // PPS/APM tracking — called from lockPiece (one piece placed) and from
  // every keyboard/touch action below (one deliberate input). Sandbox is
  // excluded: it's a goalless practice mode, these rate stats don't mean
  // much there. Recomputed at event time rather than every frame, matching
  // why TIME itself is a direct DOM write instead of React state.
  const countPiece = () => {
    if (mode !== 'sprint' && mode !== 'blitz' && mode !== 'versus') return;
    piecesLockedRef.current += 1;
    const sec = elapsedTimeRef.current / 1000;
    setPps(sec > 0 ? piecesLockedRef.current / sec : 0);
  };
  const countAction = () => {
    if (mode !== 'sprint' && mode !== 'blitz' && mode !== 'versus') return;
    actionsRef.current += 1;
    const min = elapsedTimeRef.current / 60000;
    setApm(min > 0 ? actionsRef.current / min : 0);
  };

  // Touch equivalents of the keyboard handlers below — they drive the same
  // keysDown/dasTimers refs the DAS/ARR loop in update() already reads, so
  // holding a move button repeats exactly like holding the arrow key does.
  const touchMoveStart = (dir: -1 | 1) => {
    if (!canAct()) return;
    if (dir === -1) keysDown.current.left = true; else keysDown.current.right = true;
    dasTimers.current.das = 0;
    dasTimers.current.arr = 0;
    dasTimers.current.dcd = 0;
    playerMove(dir);
    countAction();
  };
  const touchMoveEnd = (dir: -1 | 1) => {
    if (dir === -1) keysDown.current.left = false; else keysDown.current.right = false;
  };
  const touchSoftDropStart = () => {
    if (!canAct()) return;
    keysDown.current.down = true;
    countAction();
  };
  const touchSoftDropEnd = () => {
    keysDown.current.down = false;
  };
  const touchRotate = (dir: number) => {
    if (!canAct()) return;
    playerRotate(dir);
    countAction();
  };
  const touchHardDrop = () => {
    if (!canAct()) return;
    hardDrop();
    countAction();
  };
  const touchHold = () => {
    if (!canAct()) return;
    holdPiece();
    countAction();
  };

  const drawMatrix = (ctx: CanvasRenderingContext2D, matrix: number[][], offset: { x: number, y: number }, isGhost = false) => {
    matrix.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value !== 0) {
          const color = COLORS[value] as string;
          if (isGhost) {
            ctx.fillStyle = color; ctx.globalAlpha = 0.2; ctx.shadowBlur = 0;
            ctx.fillRect((x + offset.x) * BLOCK_SIZE + 1, (y + offset.y) * BLOCK_SIZE + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
            ctx.globalAlpha = 0.5; ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.strokeRect((x + offset.x) * BLOCK_SIZE + 1, (y + offset.y) * BLOCK_SIZE + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
            ctx.globalAlpha = 1.0; 
          } else {
            ctx.fillStyle = color; ctx.shadowBlur = 10; ctx.shadowColor = color;
            ctx.fillRect((x + offset.x) * BLOCK_SIZE + 1, (y + offset.y) * BLOCK_SIZE + 1, BLOCK_SIZE - 2, BLOCK_SIZE - 2);
          }
        }
      });
    });
  };

  const draw = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 1;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) ctx.strokeRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    }
    drawMatrix(ctx, board.current, { x: 0, y: 0 }); 
    const ghostY = getGhostY();
    drawMatrix(ctx, player.current.matrix, { x: player.current.pos.x, y: ghostY }, true);
    drawMatrix(ctx, player.current.matrix, player.current.pos); 
  };

  const update = (time = 0) => {
    if (lastTime.current === 0) {
      lastTime.current = time;
      requestRef.current = requestAnimationFrame(update);
      return;
    }

    const deltaTime = time - lastTime.current;
    lastTime.current = time;

    if (gameStateRef.current === 'PLAYING') {
      // Labeled so the Blitz-timeout branch below can bail out of just this
      // frame's game logic with `break`. It used to `return` here, which
      // exited update() itself and skipped the requestAnimationFrame(update)
      // call at the very bottom of this function — permanently killing the
      // game loop the instant Blitz's clock hit zero, so no amount of
      // clicking "Play Again" afterward could ever resume it.
      playingFrame: {

      if (gameStartTimeRef.current === 0) {
        gameStartTimeRef.current = time;
      }

      if (!isPausedRef.current && !showControlsRef.current) {
        elapsedTimeRef.current = time - gameStartTimeRef.current;

        if ((mode === 'sprint' || mode === 'standard' || mode === 'versus') && timeDisplayRef.current) {
           // Sandbox's stopwatch just counts up, same as Sprint's — it's
           // reset (not stopped) whenever the board clears, in handleGameOver.
           timeDisplayRef.current.innerText = formatTime(elapsedTimeRef.current);
        } else if (mode === 'blitz' && timeDisplayRef.current) {
           // --- NEW: BLITZ TIMER LOGIC ---
           const timeLeft = Math.max(0, BLITZ_TIME_LIMIT - elapsedTimeRef.current);
           timeDisplayRef.current.innerText = formatTime(timeLeft);

           if (timeLeft === 0) {
              handleGameOver(true);
              break playingFrame;
           }
        }
      }

      if (actionTextRef.current.timer > 0) {
        actionTextRef.current.timer -= deltaTime;
        if (actionTextRef.current.timer <= 0) {
          actionTextRef.current.text = '';
          syncUi();
        }
      }

      if (!isPausedRef.current && !showControlsRef.current) {
        if (keysDown.current.left || keysDown.current.right) {
          if (dasTimers.current.dcd > 0) {
            dasTimers.current.dcd -= deltaTime;
          } else {
            dasTimers.current.das += deltaTime;
            if (dasTimers.current.das >= tuningRef.current.das) {
              dasTimers.current.arr += deltaTime;
              const currentArr = tuningRef.current.arr;
              if (currentArr === 0) {
                let moved = true;
                while(moved) moved = playerMove(keysDown.current.left ? -1 : 1);
              } else {
                while (dasTimers.current.arr >= currentArr) {
                  playerMove(keysDown.current.left ? -1 : 1);
                  dasTimers.current.arr -= currentArr;
                }
              }
            }
          }
        } else {
          dasTimers.current.das = 0;
          dasTimers.current.arr = 0;
          dasTimers.current.dcd = 0;
        }

        if (keysDown.current.down) {
           // With 0-G, dropInterval is Infinity, so the dropCounter-based
           // accumulation below can never trip — soft drop would silently do
           // nothing at less-than-max SDF. Route it through the same instant
           // ghost-jump the max-SDF case already uses, so holding down always
           // fully drops the piece regardless of the SDF setting.
           if (tuningRef.current.sdf >= 41 || zeroGravityRef.current) {
              const dist = getGhostY() - player.current.pos.y;
              if (dist > 0) {
                if (mode === 'blitz' || mode === 'standard') scoreRef.current += dist;
                player.current.pos.y += dist;
                lastMoveRef.current = 'drop';
                syncUi();
              }
           } else {
              dropCounter.current += deltaTime * tuningRef.current.sdf; 
              lastMoveRef.current = 'drop';
           }
        } else {
           dropCounter.current += deltaTime;
        }

        if (player.current.pos.y > lowestYRef.current) {
           lowestYRef.current = player.current.pos.y;
           lockResetsRef.current = 0; 
           lockTimerRef.current = 0; // ◄ 1. ADD THIS: Only reset the timer when falling to a new depth
        }

        player.current.pos.y++;
        const isSupported = collide(board.current, player.current);
        player.current.pos.y--;

        if (isSupported) {
          isLockingRef.current = true;
          lockTimerRef.current += deltaTime;
          if (lockTimerRef.current >= 500) lockPiece();
        } else {
          isLockingRef.current = false;
          // ◄ 2. REMOVE the lockTimerRef.current = 0; that was here!
          
          if (dropInterval.current <= 0) {
             player.current.pos.y = getGhostY();
             dropCounter.current = 0;
          } else if (dropCounter.current > dropInterval.current) {
            const drops = Math.floor(dropCounter.current / dropInterval.current);
            const isSoftDrop = keysDown.current.down && tuningRef.current.sdf < 41;
            playerDrop(drops, isSoftDrop);
            
            if (dropCounter.current > 0) {
               dropCounter.current %= dropInterval.current; 
            }
          }
        }
      }
      } // end playingFrame

      // Live opponent-preview broadcast — the piece's actual current matrix
      // (already rotated) and position, not just its type/spawn point, so
      // MiniBoard can render exactly what's happening rather than guessing.
      // Throttled rather than tied to any specific action, so it also covers
      // plain gravity between inputs, which the once-per-lock broadcast
      // alone never captured.
      if (mode === 'versus' && time - lastPreviewBroadcastRef.current > PREVIEW_BROADCAST_INTERVAL_MS) {
        lastPreviewBroadcastRef.current = time;
        onBoardUpdate?.(board.current, player.current.matrix, player.current.pos.x, player.current.pos.y, livesRemainingRef.current);
      }
    }

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) draw(ctx, canvas);
    }
    requestRef.current = requestAnimationFrame(update);
  };

  useEffect(() => {
    playerReset();
    requestRef.current = requestAnimationFrame(update);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'PLAYING') return;

      if (listeningActionRef.current) {
        e.preventDefault();
        const targetAction = listeningActionRef.current;
        setControls(prev => ({ ...prev, [targetAction]: e.key }));
        listeningActionRef.current = null;
        setListeningAction(null);
        return;
      }
      
      const c = controlsRef.current;
      const mappedKeys = Object.values(c);
      
      if (mappedKeys.includes(e.key) || e.key === 'p' || e.key === 'Escape') {
        e.preventDefault(); 
      }
      
      if (e.key === 'p' || e.key === 'Escape') {
        const willShow = !showControlsRef.current;
        showControlsRef.current = willShow;
        setShowControls(willShow); 
        isPausedRef.current = willShow; 
        setIsPaused(willShow); 
        return;
      }

      if (isPausedRef.current || showControlsRef.current) return;
      if (e.repeat) return; 

      if (e.key === c['Left']) {
        keysDown.current.left = true;
        dasTimers.current.das = 0;
        dasTimers.current.arr = 0;
        dasTimers.current.dcd = 0;
        playerMove(-1);
        countAction();
      }
      else if (e.key === c['Right']) {
        keysDown.current.right = true;
        dasTimers.current.das = 0;
        dasTimers.current.arr = 0;
        dasTimers.current.dcd = 0;
        playerMove(1);
        countAction();
      }
      else if (e.key === c['Down']) { keysDown.current.down = true; countAction(); }
      else if (e.key === c['Rotate CW']) { playerRotate(1); countAction(); }
      else if (e.key === c['Rotate CCW']) { playerRotate(-1); countAction(); }
      else if (e.key === c['Rotate 180']) { playerRotate(2); countAction(); }
      else if (e.key === c['Hard Drop']) {
        if (!keysDown.current.hardDrop) {
            keysDown.current.hardDrop = true;
            hardDrop();
            countAction();
        }
      }
      else if (e.key === c['Hold']) { holdPiece(); countAction(); }
      else if (mode === 'standard' && e.key === c['Clear Board']) clearSandboxBoard();
      else if (mode === 'standard' && e.key === c['Toggle 0-G']) toggleZeroGravity();
      else if (mode === 'standard') {
        const pieceHotkey = SPAWN_HOTKEY_ACTIONS.find((p) => e.key === c[p.action]);
        if (pieceHotkey) spawnSandboxPiece(pieceHotkey.type);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const c = controlsRef.current;
      
      if (e.key === c['Left']) keysDown.current.left = false;
      if (e.key === c['Right']) keysDown.current.right = false;
      if (e.key === c['Down']) keysDown.current.down = false;
      if (e.key === c['Hard Drop']) keysDown.current.hardDrop = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { 
      window.removeEventListener('keydown', handleKeyDown); 
      window.removeEventListener('keyup', handleKeyUp);
      if (requestRef.current) cancelAnimationFrame(requestRef.current); 
    };
  }, []);

  // Every opponent in the match roster gets a preview slot from the moment
  // the match starts, not just the ones who've locked a piece yet — without
  // this, a bigger lobby's previews would pop in one at a time as each
  // opponent places their first piece instead of all showing up (empty)
  // immediately. Falls back to opponentBoards' own guestIds if opponentIds
  // wasn't passed, matching the old behavior.
  // Placeholder piece for an opponent whose own first broadcast hasn't
  // arrived yet — versus's bag is seeded identically for everyone (see
  // initialPieceTypeRef above), so this is provably their real first piece,
  // at the same spawn position playerReset() itself would use.
  const initialPieceMatrix = PIECES[initialPieceTypeRef.current];
  const initialPieceX = Math.floor(COLS / 2) - Math.floor(initialPieceMatrix[0].length / 2);
  const previewBoards = (opponentIds ?? opponentBoards?.map((b) => b.guestId) ?? []).map((guestId) => {
    const real = opponentBoards?.find((b) => b.guestId === guestId);
    const eliminated = eliminatedOpponentIds?.includes(guestId) ?? false;
    return real
      ? { ...real, eliminated }
      : { guestId, board: EMPTY_MINI_BOARD, pieceMatrix: initialPieceMatrix, pieceX: initialPieceX, pieceY: 0, eliminated, livesRemaining: lives ?? 1 };
  });

  // A genuine 1v1 (exactly one opponent) on a desktop-sized viewport gets its
  // own large board rendered directly beside the player's, rather than the
  // small side-column preview used for a fuller room — there's no rest of
  // the room competing for space, and it's the one board actually worth
  // reading at a glance. Mobile keeps the compact column regardless (no
  // static pixel width for the main board there — it's a CSS min() against
  // viewport width — so there's nothing reliable to size 90% of).
  const isDesktopOneVOne = mode === 'versus' && !isMobile && previewBoards.length === 1;
  // Main board is a fixed COLS*BLOCK_SIZE (300px) canvas on desktop; 90% of
  // that. Fixed (not cellSize-proportional) gap/padding here — see MiniBoard
  // above for why — so solving total-width = COLS*cellSize + (COLS-1)*gap +
  // 2*padding for cellSize lands the *whole board*, not just its cells, at
  // that 90% target, and the height comes out at essentially the same 90%
  // too rather than visibly short.
  const ONE_V_ONE_GAP = 1;
  const ONE_V_ONE_PADDING = 4;
  const oneVOneBoardWidth = COLS * BLOCK_SIZE * 0.9;
  const oneVOneCellSize = (oneVOneBoardWidth - 2 * ONE_V_ONE_PADDING - (COLS - 1) * ONE_V_ONE_GAP) / COLS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isMobile ? '0.6rem' : 0, width: '100%', maxWidth: isMobile ? '100%' : (isDesktopOneVOne ? '68rem' : '48rem'), fontFamily: 'monospace', userSelect: 'none' }}>
    <div style={{ display: 'flex', flexDirection: 'row', gap: isMobile ? '0.5rem' : '3rem', alignItems: 'flex-start', justifyContent: 'center', width: '100%' }}>

      {/* Left Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0.5rem' : '1.5rem', width: isMobile ? '4rem' : '7rem', flexShrink: 0, paddingTop: isMobile ? 0 : '1rem', justifyContent: 'space-between', alignItems: 'stretch', height: isMobile ? 'auto' : '600px' }}>
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0.4rem' : '0.75rem' }}>
            <p style={{ fontSize: isMobile ? '0.55rem' : '0.75rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 'bold', margin: '0 auto', width: 'fit-content', padding: isMobile ? '1px 5px' : '2px 8px', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '4px' }}>HOLD</p>
            <div style={{ width: isMobile ? '4rem' : '7rem', height: isMobile ? '3.2rem' : '6rem', backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.375rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)' }}>
               <MiniPiece type={uiState.hold} />
            </div>
          </div>

          {(gameState === 'PLAYING' || gameState === 'COUNTDOWN') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: isMobile ? '0.6rem' : '1.5rem' }}>
              <button
                onClick={() => openPanel('controls')}
                style={{ padding: isMobile ? '5px 2px' : '8px', backgroundColor: 'color-mix(in srgb, var(--tt-accent) 15%, black)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '8px' : '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
              >
                {showControls && settingsTab === 'controls' ? 'Resume' : 'Settings'}
              </button>
              {mode === 'standard' && (
                <button
                  onClick={() => openPanel('sandbox')}
                  style={{ padding: isMobile ? '5px 2px' : '8px', backgroundColor: 'color-mix(in srgb, var(--tt-accent) 15%, black)', color: 'var(--tt-accent)', border: '1px solid color-mix(in srgb, var(--tt-accent) 30%, transparent)', borderRadius: '4px', cursor: 'pointer', fontSize: isMobile ? '8px' : '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                >
                  {showControls && settingsTab === 'sandbox' ? 'Resume' : 'Sandbox'}
                </button>
              )}
            </div>
          )}
        </div>

        <button onClick={onMenu} style={{ padding: isMobile ? '5px 2px' : '8px', backgroundColor: 'color-mix(in srgb, var(--tt-accent) 15%, black)',
          color: 'var(--tt-accent)', border: '1px solid color-mix(in srgb, var(--tt-accent) 30%, transparent)', borderRadius: '4px',
          cursor: 'pointer', fontSize: isMobile ? '8px' : '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Quit
        </button>
      </div>

      {/* Garbage Bar — versus-only, one segment per board row (ROWS total),
          filled from the bottom to show how many garbage lines are queued
          and about to land on this client's next piece lock. */}
      {mode === 'versus' && (
        <div style={{ alignSelf: 'stretch', width: isMobile ? '0.4rem' : '0.7rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', height: '100%' }}>
            {Array.from({ length: ROWS }).map((_, i) => {
              const filled = i >= ROWS - pendingGarbageDisplay;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    borderRadius: '1px',
                    backgroundColor: filled ? '#f87171' : 'rgba(255,255,255,0.06)',
                    boxShadow: filled ? '0 0 6px rgba(248,113,113,0.8)' : 'none',
                    transition: 'background-color 0.15s ease',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Center Panel — wrapped in a column so an optional "Lives" tag can
          sit above the board itself, same small-label language as
          HOLD/NEXT/OPPONENT elsewhere, only shown once the host actually
          turns lives on (see the HUD's own gating for why the default stays
          untouched). */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
        {mode === 'versus' && (lives ?? 1) > 1 && (
          <p style={{ fontSize: isMobile ? '0.6rem' : '0.75rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 'bold', margin: 0, padding: isMobile ? '1px 6px' : '2px 8px', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '4px', textTransform: 'uppercase' }}>
            Lives: {livesDisplay} / {lives}
          </p>
        )}
      <div style={{ position: 'relative', border: '2px solid rgba(255,255,255,0.1)', backgroundColor: 'black', borderRadius: '0.5rem', boxShadow: '0 0 30px rgba(0,0,0,0.5)', overflow: 'hidden', flexShrink: 0 }}>
        <canvas ref={canvasRef} width={300} height={600} style={isMobile ? { display: 'block', width: 'min(190px, calc(100vw - 224px))', height: 'auto' } : { display: 'block' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: '100% 4px' }} />

        {/* COUNTDOWN OVERLAY */}
        {gameState === 'COUNTDOWN' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <h2 style={{ color: 'var(--tt-accent)', fontSize: '5rem', fontWeight: 'bold', textShadow: '0 0 20px color-mix(in srgb, var(--tt-accent) 80%, transparent)', margin: 0, letterSpacing: '0.1em', animation: 'pop 0.3s ease-out' }}>
              {countdownText}
            </h2>
          </div>
        )}

        {/* HIGH SCORE ENTRY OVERLAY */}
        {gameState === 'NAME_ENTRY' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: '2rem', overflowY: 'auto' }}>
             <h3 style={{ color: 'var(--tt-accent)', letterSpacing: '0.1em', marginBottom: '1rem', marginTop: 0, fontSize: '1.25rem', textAlign: 'center' }}>
               {mode === 'sprint' ? 'NEW BEST TIME!' : 'NEW HIGH SCORE!'}
             </h3>
             <p style={{ color: 'white', marginBottom: '2rem', fontSize: '2rem', fontWeight: 'bold', textShadow: '0 0 10px rgba(255,255,255,0.5)', margin: '0 0 2rem 0' }}>
               {mode === 'sprint' ? formatTime(uiState.score) : uiState.score}
             </p>
             
             <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Enter Initials</p>
             <input 
               autoFocus
               maxLength={3}
               value={nameInput}
               onChange={(e) => setNameInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
               onKeyDown={(e) => { if (e.key === 'Enter') saveHighScore(); }}
               style={{ backgroundColor: 'transparent', border: 'none', borderBottom: '2px solid var(--tt-accent)', color: 'white', fontSize: '2.5rem', width: '6rem', textAlign: 'center', textTransform: 'uppercase', outline: 'none', fontFamily: 'monospace', letterSpacing: '0.2em', padding: '0 0 0.5rem 0' }}
             />
             <button disabled={isSubmitting} onClick={saveHighScore} style={{ marginTop: '2.5rem', backgroundColor: 'var(--tt-accent)', color: 'white', border: 'none', borderRadius: '4px', padding: '10px 32px', cursor: 'pointer', textTransform: 'uppercase', fontSize: '14px', letterSpacing: '0.1em', fontWeight: 'bold', opacity: isSubmitting ? 0.5 : 1 }}>
               {isSubmitting ? 'Saving...' : 'Save'}
             </button>
          </div>
        )}

        {/* VERSUS RESULT OVERLAY — Rematch returns to the lobby without
            leaving the room (see onRematchMenu, wired in VersusApp). Reflects
            either this client's own topout or outlasting every opponent (see
            handleGameOver's versus branch and the last-standing effect above). */}
        {gameState === 'LEADERBOARD' && mode === 'versus' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: '2rem 1.5rem', overflowY: 'auto' }}>
            <h3 style={{ color: 'var(--tt-accent)', letterSpacing: '0.15em', marginBottom: '1rem', marginTop: 0, fontSize: '1.1rem', textAlign: 'center' }}>
              {versusOutcome === 'won-last-standing' && 'YOU WIN — LAST ONE STANDING'}
              {versusOutcome === 'lost-topout' && 'TOPPED OUT'}
            </h3>
            <p style={{ color: 'white', fontSize: '2rem', fontWeight: 'bold', textShadow: '0 0 10px rgba(255,255,255,0.5)', margin: '0 0 2rem 0' }}>
              {formatTime(uiState.score)}
            </p>
            <button
              onClick={onRematchMenu}
              style={{ backgroundColor: 'var(--tt-accent)', color: 'white', border: 'none', borderRadius: '4px', padding: '10px 32px', cursor: 'pointer', textTransform: 'uppercase', fontSize: '14px', letterSpacing: '0.1em', fontWeight: 'bold' }}
            >
              Rematch
            </button>
          </div>
        )}

        {/* LEADERBOARD OVERLAY */}
        {gameState === 'LEADERBOARD' && mode !== 'versus' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 30, padding: '2rem 1.5rem', overflowY: 'auto' }}>
            <h3 style={{ color: 'white', letterSpacing: '0.2em', marginBottom: '1.5rem', marginTop: 0, fontSize: '1.25rem', textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>LEADERBOARD</h3>
            
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
              {leaderboard.length === 0 && (
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', textAlign: 'center', marginTop: '2rem' }}>NO SCORES YET</p>
              )}
              {leaderboard.map((entry, i) => (
                 <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', backgroundColor: i === 0 ? 'color-mix(in srgb, var(--tt-accent) 10%, transparent)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <span style={{ color: i === 0 ? 'var(--tt-accent)' : 'rgba(255,255,255,0.5)', fontSize: '12px', width: '1.5rem' }}>#{i + 1}</span>
                      <span style={{ color: i === 0 ? 'white' : 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.1em' }}>{entry.name}</span>
                    </div>
                    <span style={{ color: i === 0 ? 'var(--tt-accent)' : 'white', fontSize: '14px', fontFamily: 'monospace', textShadow: i === 0 ? '0 0 8px color-mix(in srgb, var(--tt-accent) 50%, transparent)' : 'none' }}>
                      {mode === 'sprint' ? formatTime(entry.score) : entry.score}
                    </span>
                 </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', marginTop: '1rem' }}>
               <button onClick={restartGame} style={{ backgroundColor: 'var(--tt-accent)', color: 'white', border: 'none', borderRadius: '4px', padding: '12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                 Play Again
               </button>
               <button onClick={onMenu} style={{ backgroundColor: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', borderRadius: '4px', padding: '10px', cursor: 'pointer', fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                 Main Menu
               </button>
            </div>
          </div>
        )}

        {/* PAUSE OVERLAY */}
        {isPaused && !showControls && gameState === 'PLAYING' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <h3 style={{ color: 'white', letterSpacing: '0.3em', margin: 0, textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>PAUSED</h3>
          </div>
        )}

        {/* SETTINGS OVERLAY */}
        {showControls && (gameState === 'PLAYING' || gameState === 'COUNTDOWN') && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 20, padding: '2rem 1.5rem', overflowY: 'auto' }}>
            
            <h3 style={{ color: 'white', border: 'rgba(235, 15, 96, 0.65)', letterSpacing: '0.25em', marginBottom: '1.2rem', marginTop: 0, fontSize: '1.1rem' }}>
              {settingsTab === 'sandbox' ? 'Sandbox' : 'Settings'}
            </h3>

            {settingsTab === 'controls' && (
              <>
                <p style={{ color: 'var(--tt-accent)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.75rem 0', alignSelf: 'flex-start' }}>Keybinds</p>
                <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
                  {Object.entries(controls)
                    .filter(([action]) => action !== 'null' && !(SANDBOX_HOTKEY_ACTIONS as readonly string[]).includes(action))
                    .map(([action, keyName]) => (
                    <div key={action} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', textTransform: 'uppercase', textAlign: 'center' }}>
                        {action}
                      </span>
                      <button
                        onClick={() => {
                          setListeningAction(action);
                          listeningActionRef.current = action;
                        }}
                        style={{ backgroundColor: listeningAction === action ? 'var(--tt-accent)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', fontSize: '10px', cursor: 'pointer', width: '100%', maxWidth: '90px', textAlign: 'center', height: '26px' }}
                      >
                        {listeningAction === action ? '...' : (keyName === ' ' ? 'Space' : keyName.replace('Arrow', ''))}
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                  <p style={{ color: 'var(--tt-accent)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>Handling</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>DAS (Delay)</span>
                      <span style={{ color: 'white', fontSize: '10px' }}>{tuning.das}ms</span>
                    </div>
                    <input type="range" min="50" max="300" step="10" value={tuning.das} onChange={(e) => setTuning(p => ({...p, das: Number(e.target.value)}))} style={{ width: '100%', accentColor: 'var(--tt-accent)', height: '4px' }} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>ARR (Speed)</span>
                      <span style={{ color: 'white', fontSize: '10px' }}>{tuning.arr}ms</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value={tuning.arr} onChange={(e) => setTuning(p => ({...p, arr: Number(e.target.value)}))} style={{ width: '100%', accentColor: 'var(--tt-accent)', height: '4px' }} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>DCD (DAS Cut)</span>
                      <span style={{ color: 'white', fontSize: '10px' }}>{tuning.dcd}ms</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value={tuning.dcd} onChange={(e) => setTuning(p => ({...p, dcd: Number(e.target.value)}))} style={{ width: '100%', accentColor: 'var(--tt-accent)', height: '4px' }} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>SDF (Soft Drop)</span>
                      <span style={{ color: 'white', fontSize: '10px' }}>{tuning.sdf >= 41 ? 'MAX' : `${tuning.sdf}x`}</span>
                    </div>
                    <input type="range" min="2" max="41" step="1" value={tuning.sdf} onChange={(e) => setTuning(p => ({...p, sdf: Number(e.target.value)}))} style={{ width: '100%', accentColor: 'var(--tt-accent)', height: '4px' }} />
                  </div>
                </div>
              </>
            )}

            {settingsTab === 'sandbox' && mode === 'standard' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', opacity: zeroGravity ? 0.4 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>Gravity Level</span>
                    <span style={{ color: 'white', fontSize: '10px' }}>{uiState.level}</span>
                  </div>
                  <input
                    type="range" min="1" max="20" step="1"
                    value={uiState.level}
                    onChange={(e) => {
                      const level = Number(e.target.value);
                      levelRef.current = level;
                      if (zeroGravity) { setZeroGravity(false); zeroGravityRef.current = false; }
                      dropInterval.current = calculateDropInterval(level);
                      syncUi();
                    }}
                    style={{ width: '100%', accentColor: 'var(--tt-accent)', height: '4px' }}
                  />
                </div>

                <button
                  onClick={toggleZeroGravity}
                  style={{
                    backgroundColor: zeroGravity ? 'color-mix(in srgb, var(--tt-accent) 25%, transparent)' : 'rgba(255,255,255,0.1)',
                    color: zeroGravity ? 'var(--tt-accent)' : 'white',
                    border: zeroGravity ? '1px solid var(--tt-accent)' : '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '4px', padding: '8px', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}
                >
                  {zeroGravity ? 'Zero-G Enabled — Tap to Disable' : 'Enable Zero-G (No Gravity)'}
                </button>

                <button
                  onClick={clearSandboxBoard}
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '8px', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                >
                  Clear Board
                </button>

                <div>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', display: 'block', marginBottom: '8px' }}>Spawn Piece</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {SPAWN_HOTKEY_ACTIONS.map(({ type, action }) => (
                      <div key={type} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <button
                          onClick={() => {
                            spawnSandboxPiece(type);
                            showControlsRef.current = false;
                            setShowControls(false);
                            isPausedRef.current = false;
                            setIsPaused(false);
                          }}
                          style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '6px', cursor: 'pointer', width: '100%', aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <MiniPiece type={type} />
                        </button>
                        <button
                          onClick={() => {
                            setListeningAction(action);
                            listeningActionRef.current = action;
                          }}
                          style={{ backgroundColor: listeningAction === action ? 'var(--tt-accent)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', padding: '4px', fontSize: '10px', cursor: 'pointer', width: '100%', textAlign: 'center', height: '22px' }}
                        >
                          {listeningAction === action ? '...' : (controls[action] === ' ' ? 'Space' : controls[action].replace('Arrow', ''))}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.85rem' }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', display: 'block' }}>Hotkeys</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                    {SANDBOX_GENERAL_HOTKEY_ACTIONS.map((action) => (
                      <div key={action} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', textTransform: 'uppercase', textAlign: 'center' }}>
                          {action}
                        </span>
                        <button
                          onClick={() => {
                            setListeningAction(action);
                            listeningActionRef.current = action;
                          }}
                          style={{ backgroundColor: listeningAction === action ? 'var(--tt-accent)' : 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '4px', padding: '6px', fontSize: '10px', cursor: 'pointer', width: '100%', maxWidth: '90px', textAlign: 'center', height: '26px' }}
                        >
                          {listeningAction === action ? '...' : (controls[action] === ' ' ? 'Space' : controls[action].replace('Arrow', ''))}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                showControlsRef.current = false;
                setShowControls(false);
                isPausedRef.current = false;
                setIsPaused(false);
              }}
              style={{ marginTop: '1.5rem', backgroundColor: 'var(--tt-accent)', color: 'white', border: 'none', borderRadius: '4px', padding: '8px 24px', cursor: 'pointer', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.1em' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Right Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0.5rem' : '2rem', width: isMobile ? '4rem' : '7rem', flexShrink: 0, paddingTop: isMobile ? 0 : '1rem', alignItems: 'stretch', justifyContent: 'flex-start', height: isMobile ? 'auto' : '600px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0.4rem' : '0.75rem' }}>
          <p style={{ fontSize: isMobile ? '0.55rem' : '0.75rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 'bold', margin: '0 auto', width: 'fit-content', padding: isMobile ? '1px 5px' : '2px 8px', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '4px' }}>NEXT</p>
          <div style={{ width: isMobile ? '4rem' : '7rem', backgroundColor: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.375rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0.4rem 0' : '1rem 0', gap: isMobile ? '0.4rem' : '1.5rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)', margin: '0 auto' }}>
             {uiState.next.slice(0, isMobile ? 3 : 5).map((type, idx) => <MiniPiece key={idx} type={type} />)}
          </div>
        </div>

        {/* Solid backdrop (matching the Hold/Next boxes) so these numbers stay
            readable no matter how bright or busy the selected background is —
            plain text sitting directly on the theme image used to wash out. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '0.5rem' : '1rem', backgroundColor: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.375rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)', padding: isMobile ? '0.4rem 0.35rem' : '1rem 0.85rem', textAlign: 'right', flex: 1 }}>

          {/* --- UI RENDER BRANCHING --- */}
          {mode === 'sprint' ? (
            <>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Time</p>
                <p ref={timeDisplayRef} style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'var(--tt-accent)', fontWeight: 'bold', textShadow: '0 0 8px color-mix(in srgb, var(--tt-accent) 50%, transparent)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  00:00.000
                </p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Lines Left</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>
                  {Math.max(0, SPRINT_GOAL - uiState.lines)}
                </p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>PPS</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{pps.toFixed(2)}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>APM</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{apm.toFixed(0)}</p>
              </div>
            </>
          ) : mode === 'versus' ? (
            <>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Time</p>
                <p ref={timeDisplayRef} style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'var(--tt-accent)', fontWeight: 'bold', textShadow: '0 0 8px color-mix(in srgb, var(--tt-accent) 50%, transparent)', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  00:00.000
                </p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Sent</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{linesSent}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>PPS</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{pps.toFixed(2)}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>APM</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{apm.toFixed(0)}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Attack/Min</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{attackPerMin.toFixed(1)}</p>
              </div>
            </>
          ) : mode === 'blitz' ? (
            <>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Score</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'var(--tt-accent)', fontWeight: 'bold', textShadow: '0 0 8px color-mix(in srgb, var(--tt-accent) 50%, transparent)', margin: 0 }}>{uiState.score}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Time Left</p>
                <p ref={timeDisplayRef} style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  03:00.000
                </p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Lines</p>
                <p style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{uiState.lines}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>PPS</p>
                <p style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{pps.toFixed(2)}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>APM</p>
                <p style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{apm.toFixed(0)}</p>
              </div>
            </>
          ) : (
            // Sandbox mode: score is back (good for testing combos/B2B/the
            // point system) but there's still no leaderboard for it — plus a
            // practice stopwatch (resets whenever the board clears, see
            // handleGameOver), the gravity level, and a lines-cleared tally.
            <>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Score</p>
                <p style={{ fontSize: isMobile ? '0.9rem' : '1.25rem', color: 'var(--tt-accent)', fontWeight: 'bold', textShadow: '0 0 8px color-mix(in srgb, var(--tt-accent) 50%, transparent)', margin: 0 }}>{uiState.score}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Time</p>
                <p ref={timeDisplayRef} style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  00:00.000
                </p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Gravity</p>
                <p style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{zeroGravity ? 'Zero-G' : `Lv ${uiState.level}`}</p>
              </div>
              <div>
                <p style={{ fontSize: isMobile ? '7px' : '10px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem', margin: 0 }}>Lines</p>
                <p style={{ fontSize: isMobile ? '0.8rem' : '1.125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 'bold', margin: 0 }}>{uiState.lines}</p>
              </div>
            </>
          )}

          <div style={{ marginTop: 'auto', minHeight: isMobile ? '1rem' : '4rem', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {uiState.actionText && (
               <p style={{ color: 'var(--tt-accent)', fontSize: isMobile ? '8px' : '11px', fontWeight: 'bold', textShadow: '0 0 8px color-mix(in srgb, var(--tt-accent) 80%, transparent)', margin: 0, lineHeight: 1.4, textTransform: 'uppercase' }}>
                 {uiState.actionText.split('\n').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
               </p>
            )}
          </div>
        </div>
      </div>

      {/* Opponent board, 1v1 only — sits further right than the Right Panel
          (stats stay closest to the player's own board; the opponent's board
          is the thing being compared, so it reads left-to-right as "mine,
          my stats, theirs"), at 90% of the main board's size (see
          isDesktopOneVOne above). A fuller room falls back to the compact
          side-column preview below instead. */}
      {isDesktopOneVOne && previewBoards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', flexShrink: 0, paddingTop: '1rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 'bold', margin: 0, padding: '3px 10px', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '4px' }}>
            OPPONENT
          </p>
          {/* Same gating as the player's own Lives tag above the main board
              — only shown once the match actually has lives turned on. */}
          {(lives ?? 1) > 1 && (
            <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em', textAlign: 'center', fontWeight: 'bold', margin: 0, padding: '2px 8px', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '4px' }}>
              {previewBoards[0].livesRemaining} / {lives} LIVES
            </p>
          )}
          <MiniBoard board={previewBoards[0].board} cellSize={oneVOneCellSize} gap={ONE_V_ONE_GAP} padding={ONE_V_ONE_PADDING} pieceMatrix={previewBoards[0].pieceMatrix} pieceX={previewBoards[0].pieceX} pieceY={previewBoards[0].pieceY} eliminated={previewBoards[0].eliminated} />
        </div>
      )}

      {/* Opponent Previews — versus-only compact column, one MiniBoard per
          opponent (see onBoardUpdate in lockPiece and previewBoards above).
          Used for a fuller room (isDesktopOneVOne's big adjacent board above
          handles the true-1v1 desktop case instead) and for mobile, where
          there's no reliable fixed main-board pixel width to size an
          adjacent board off of. Wraps so it scales from a couple of
          opponents up to a full room without a per-count layout. A single
          opponent (mobile 1v1) still gets a size bump over a fuller room,
          just not the full side-by-side treatment. */}
      {mode === 'versus' && !isDesktopOneVOne && previewBoards.length > 0 && (() => {
        const isOneVOne = previewBoards.length === 1;
        const cellSize = isOneVOne ? 7.5 : 5;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: isOneVOne ? '9rem' : '6rem', flexShrink: 0, paddingTop: isMobile ? 0 : '1rem' }}>
            <p style={{ fontSize: isMobile ? '0.55rem' : '0.7rem', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.1em', textAlign: 'center', fontWeight: 'bold', margin: '0 auto', width: 'fit-content', padding: isMobile ? '1px 5px' : '2px 8px', backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: '4px' }}>
              {isOneVOne ? 'OPPONENT' : 'OPPONENTS'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'center', maxHeight: isMobile ? 'none' : '600px', overflowY: 'auto' }}>
              {previewBoards.map((entry) => (
                <div key={entry.guestId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
                  {/* Each opponent needs their own count here (unlike the
                      shared OPPONENT/OPPONENTS label above), since lives
                      remaining can differ from one to the next. */}
                  {(lives ?? 1) > 1 && (
                    <span style={{ fontSize: isMobile ? '0.5rem' : '0.55rem', color: 'rgba(255,255,255,0.6)', fontWeight: 'bold' }}>
                      {entry.livesRemaining} / {lives}
                    </span>
                  )}
                  <MiniBoard board={entry.board} cellSize={cellSize} pieceMatrix={entry.pieceMatrix} pieceX={entry.pieceX} pieceY={entry.pieceY} eliminated={entry.eliminated} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

    </div>{/* end inner row (Left Panel / Center Panel / Right Panel / Opponent Previews) */}

      {/* Touch controls — mobile only. There's no keyboard on a phone, so
          this is the only way to move/rotate/drop/hold there. */}
      {isMobile && (gameState === 'PLAYING' || gameState === 'COUNTDOWN') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: '300px' }}>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <TouchControlButton label="HOLD" ariaLabel="Hold piece" onClick={touchHold} />
            <TouchControlButton label="⟲" ariaLabel="Rotate counter-clockwise" onClick={() => touchRotate(-1)} />
            <TouchControlButton label="⟳" ariaLabel="Rotate clockwise" onClick={() => touchRotate(1)} />
            <TouchControlButton label="DROP" ariaLabel="Hard drop" onClick={touchHardDrop} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <TouchControlButton
              label="◀"
              ariaLabel="Move left"
              onPointerDown={() => touchMoveStart(-1)}
              onPointerUp={() => touchMoveEnd(-1)}
              onPointerLeave={() => touchMoveEnd(-1)}
              onPointerCancel={() => touchMoveEnd(-1)}
            />
            <TouchControlButton
              label="▼"
              ariaLabel="Soft drop"
              onPointerDown={touchSoftDropStart}
              onPointerUp={touchSoftDropEnd}
              onPointerLeave={touchSoftDropEnd}
              onPointerCancel={touchSoftDropEnd}
            />
            <TouchControlButton
              label="▶"
              ariaLabel="Move right"
              onPointerDown={() => touchMoveStart(1)}
              onPointerUp={() => touchMoveEnd(1)}
              onPointerLeave={() => touchMoveEnd(1)}
              onPointerCancel={() => touchMoveEnd(1)}
            />
          </div>
        </div>
      )}

    </div>
  );
}