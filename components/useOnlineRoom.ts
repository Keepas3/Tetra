'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../app/utils/supabaseClient';

// Room/lobby + synchronized start (Phase 2) and garbage-line exchange
// (Phase 3) over Supabase Realtime. No database table involved — presence +
// broadcast on an ad-hoc channel named after the room code is enough for
// both matchmaking and in-match gameplay events.
//
// Presence/ready-up/broadcasts are generalized to a list of opponents (up to
// MAX_ROOM_SIZE) rather than hard-coded to exactly one. Garbage targets a
// random still-alive opponent (VersusApp picks the target, see sendGarbage's
// targetGuestId) and the win condition is last-player-standing, tracked via
// eliminatedGuestIds below — reached once every opponent has broadcast
// 'eliminated'.

export const MAX_ROOM_SIZE = 8;

// Teams/Teams Co-op display names, 1-indexed to match the `team` field
// (team 1 -> TEAM_NAMES[0]) — used everywhere a team number would otherwise
// be shown raw (lobby picker/roster, in-match preview column labels) so a
// player only ever sees "Blue"/"Red"/"Green"/"Yellow", never "Team 3".
export const TEAM_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];

// A mid-match Quit is a vote, not a unilateral exit — the first vote opens
// this window; if every still-active player (anyone who hasn't already
// disconnected/been eliminated) votes to quit before it closes, everyone is
// returned to this same room's lobby together. Otherwise the vote just
// lapses and the match continues, with no separate rate-limit needed —
// this window IS the cooldown.
export const QUIT_VOTE_WINDOW_MS = 60_000;

// Preset quick-chat messages — index into this array is the only thing that
// crosses the wire (see QuickChatPayload), so there's no free-text input to
// moderate and no keyboard focus fight with the game's own key bindings.
export const QUICK_CHAT_MESSAGES = [
  'Good luck!',
  'Good game!',
  'Have to go, sorry',
  "Start the game already! 14",
  'One sec, wait for more',
  'Nice one!',
  'Oops, my bad',
  'Rematch?',
  'Thanks!',
] as const;

export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'occupied';

// 'versus' = today's last-player-standing match (attacks/lives/elimination).
// 'practice' = Sandbox's single-player ruleset (adjustable gravity, spawn
// hotkeys, clear-on-topout) running inside the same room/preview plumbing,
// no attacks/lives/elimination/win-condition. 'coop' = exactly two players
// sharing one board, each controlling their own independently-falling piece
// (see TetrisGame.tsx's isCoop) — score/level/lines are team-shared, either
// player topping out ends it for both. 'teams' = 2-4 self-selected teams
// (see the `team` field below), each player on their own separate board —
// unlike coop, garbage is versus's usual per-player attack/lives/elimination
// exchange, just restricted to opposing-team targets only (see VersusApp's
// handleAttack), and the match ends once every player on every other team is
// eliminated (see TetrisGame.tsx's enemyIds prop). 'teams-coop' = the same
// team structure as 'teams' (self-selected, Team Count, enemy-only garbage,
// last-team-standing), except each *team* shares one board the way coop's
// two players do — coop's merge-only sync generalizes to however many share
// a team (see TetrisGame.tsx's isTeamsCoop), and Lives becomes a team-wide
// resource instead of per-player (see BoardSnapshotPayload.livesRemaining's
// own comment). Future modes (powerups) extend this union rather than each
// getting a bespoke protocol.
export type GameMode = 'versus' | 'practice' | 'coop' | 'teams' | 'teams-coop';

interface ReadyPayload {
  guestId: string;
  // Same event carries both directions (ready and un-ready) rather than a
  // second event type — the listener just adds or removes guestId from
  // readyGuestIds based on this flag.
  ready: boolean;
}

// Quit-vote payload — same "one event, a boolean flag carries both
// directions" shape as ReadyPayload. `deadline` is only meaningful on the
// vote that actually opens the window (the first vote cast while none is
// already active) — every other client adopts that same timestamp rather
// than computing its own, so everyone's countdown agrees.
interface QuitVotePayload {
  guestId: string;
  voting: boolean;
  deadline?: number;
}

interface StartPayload {
  startAt: number;
  // Shared 7-bag RNG seed so both clients see the identical piece sequence —
  // generated fresh by the host alongside startAt, see the host-decides-start
  // effect below.
  seed: number;
  // Host-chosen room settings, current at the moment start was triggered —
  // see roomSettings below.
  startingLevel: number;
  lives: number;
  gameMode: GameMode;
  // Co-op only (see roomSettings.sharedNextHold) — whether Hold is one
  // shared slot both players can swap into and each player's Next queue is
  // visible to their partner, vs. staying fully private to each player.
  sharedNextHold: boolean;
  // Teams only — locked in at match start alongside the rest of these,
  // same reasoning as lives/startingLevel: a later settings change (e.g.
  // during a still-open lobby before Ready) shouldn't retroactively alter a
  // match already in flight.
  teamCount: number;
}

interface KickPayload {
  guestId: string;
}

// Presence payload each client tracks about itself. maxPlayers/startingLevel/
// lives are only meaningful on the host's own entry — presence replays a
// client's current tracked state to everyone (including a client that joins
// later), which is exactly what a latecomer needs to see the room's current
// settings without a separate "catch me up" round-trip.
interface PresenceMeta {
  nickname: string;
  isHost: boolean;
  // Self-selected (see setTeam below), not host-controlled — every player's
  // own presence entry carries it directly, same as nickname, rather than
  // being part of the host-only settings block below it.
  team?: number;
  maxPlayers?: number;
  startingLevel?: number;
  lives?: number;
  gameMode?: GameMode;
  sharedNextHold?: boolean;
  // Teams only, host-only (see roomSettings.teamCount) — how many teams the
  // room is split into (2-4); each team's size is maxPlayers / teamCount.
  teamCount?: number;
  // When this client originally joined — fixed at join time (see joinedAtRef),
  // not updated by retrack(). Not part of `meta` at either track() call site
  // (added alongside it as a sibling field instead — see joinChannel/retrack),
  // hence optional here; used to pick a deterministic successor if the host
  // disconnects with no replacement (see the presence-sync handler).
  joinedAt?: number;
}

interface GarbagePayload {
  guestId: string;
  amount: number;
  // VersusApp always sets this to a randomly-chosen still-alive opponent
  // before calling sendGarbage — omitted only means "no listener filters it
  // out", not a deliberate broadcast-to-all mode.
  targetGuestId?: string;
}

interface EliminatedPayload {
  guestId: string;
}

interface BoardSnapshotPayload {
  guestId: string;
  board: number[][];
  // The opponent's actual current piece — already-rotated shape plus its
  // real position on their board. Sent once per lock AND periodically
  // during play (see PREVIEW_BROADCAST_INTERVAL_MS in TetrisGame.tsx), not
  // just at spawn time, so a receiving MiniBoard can render exactly what's
  // happening rather than reconstructing/guessing a position.
  pieceMatrix: number[][];
  pieceX: number;
  pieceY: number;
  // Their current lives remaining (only meaningful when the match's lives
  // setting is above the 1-life default) — lets an opponent-preview show it
  // per-opponent without a separate broadcast. Teams-coop only: this is
  // TEAM-wide, not per-player (there's only one shared board to lose lives
  // on) — the receiving adopt-effect min-merges it (Math.min, since lives
  // only ever go down) rather than reading it as one player's own count.
  livesRemaining: number;
  // Co-op-only: the sender's own running score/level/lines. The receiving
  // client takes Math.max(mine, received) for each — not a blind overwrite
  // — since these only ever climb; that way a client's own more-progressed
  // count is never regressed by a partner's momentarily-behind broadcast
  // (see TetrisGame.tsx's isCoop adopt effect). Populated unconditionally
  // (cheap) — versus/practice just don't read them.
  score: number;
  level: number;
  lines: number;
  // Co-op-only, present ONLY on an actual lock broadcast — the piece (and
  // its locked position) this client's own lockPiece just merged into its
  // board, absent (undefined) on the periodic ~200ms position tick. The
  // receiving client merges these exact cells into its OWN board and
  // independently re-sweeps completed lines (see sweepLines in
  // TetrisGame.tsx), rather than adopting the sender's `board` wholesale —
  // merging is commutative and never erases a lock the receiver already
  // has that the sender doesn't know about yet, unlike a full-board
  // replace (which is what co-op used before this and was the actual cause
  // of pieces intermittently vanishing under normal play, not just a rare
  // simultaneous-lock edge case).
  lockedPieceMatrix?: number[][];
  lockedPieceX?: number;
  lockedPieceY?: number;
  // Co-op + sharedNextHold only (see room settings). `next` is the sender's
  // own upcoming-piece queue — display-only for the receiving side (each
  // player's own bag/queue stays private and independently driven; a
  // partner's queue is never adopted into it), used to render a "partner's
  // next" preview. `hold` is different: when sharing is on, Hold is one
  // genuinely shared slot both players read/write (adopted verbatim into
  // the receiving client's own holdPieceRef, same "adopt-not-merge" rule as
  // `board`/`score` above), so holding on either side updates what both see
  // and can swap into. Populated unconditionally, like score/level/lines —
  // versus/practice/coop-without-sharing just don't read them.
  next: number[];
  hold: number | null;
  // Teams-coop only, present ONLY on the lock broadcast where this client
  // actually called insertGarbageRows (never on the periodic tick) — the
  // exact row count and gap column it used. A shared board can't have every
  // teammate independently roll their own random gap column (they'd
  // diverge immediately, the one thing merge-only sync exists to prevent),
  // so garbage insertion is single-writer: whichever teammate's lock
  // applies it broadcasts the exact operation here, and the rest replay it
  // verbatim (never reroll) via the same insertGarbageRows call with this
  // gapCol passed in, mirroring lockedPieceMatrix's own "present only when
  // this specific event happened" contract exactly.
  insertedGarbageCount?: number;
  insertedGarbageGapCol?: number;
  // Teams-coop only, present ONLY on the broadcast fired at the exact
  // moment a client soft-resets after topping out with team lives still
  // remaining — tells every teammate to clear their own local board copy
  // and adopt the (lower) livesRemaining above, not just the one client
  // that actually topped out.
  sharedBoardCleared?: boolean;
}

interface QuickChatPayload {
  guestId: string;
  // Carried on the payload itself (not looked up from `opponents` on
  // receipt) so a message still shows the sender's name correctly even if
  // they change their nickname or leave right after sending.
  nickname: string;
  // Index into QUICK_CHAT_MESSAGES.
  messageId: number;
}

interface HostChangedPayload {
  // Already-resolved display name (nickname, or the fallback truncated
  // guestId) — receivers just render it, no lookup needed.
  displayName: string;
}

// A received (or self-sent) line in the chat log — either a real preset
// message a player sent (messageId set, indexes QUICK_CHAT_MESSAGES) or a
// system notice like a host handoff (systemText set instead). `id` is a
// local sequence number for React keys, not anything sent over the wire.
export interface QuickChatEntry {
  id: number;
  guestId: string;
  nickname: string;
  messageId?: number;
  systemText?: string;
}

// Avoids visually-ambiguous characters (0/O, 1/I) since players read these
// aloud or type them into the join box.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function randomGuestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Exported so useArena.ts can reuse the exact same key — a nickname set in
// either place should be visible in the other, they're the same "who am I"
// concept site-wide, not two separate identities.
export const NICKNAME_STORAGE_KEY = 'tetris-arena:nickname';
const DEFAULT_ROOM_SETTINGS = { maxPlayers: MAX_ROOM_SIZE, startingLevel: 1, lives: 1, gameMode: 'versus' as GameMode, sharedNextHold: false, teamCount: 2 };

export function useOnlineRoom() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [opponents, setOpponents] = useState<{ guestId: string; nickname: string; team?: number }[]>([]);
  const [selfReady, setSelfReady] = useState(false);
  const [readyGuestIds, setReadyGuestIds] = useState<Set<string>>(new Set());
  const [startAt, setStartAt] = useState<number | null>(null);
  const [matchSeed, setMatchSeed] = useState<number | null>(null);
  const [matchStartingLevel, setMatchStartingLevel] = useState<number | null>(null);
  const [matchLives, setMatchLives] = useState<number | null>(null);
  const [matchGameMode, setMatchGameMode] = useState<GameMode | null>(null);
  const [matchSharedNextHold, setMatchSharedNextHold] = useState<boolean | null>(null);
  const [matchTeamCount, setMatchTeamCount] = useState<number | null>(null);
  // Mid-match quit vote. selfQuitVote/quitVotes mirror selfReady/readyGuestIds
  // exactly (self tracked separately since a client doesn't receive its own
  // broadcast) — TetrisGame is what actually knows the match's active roster
  // (opponentIds minus anyone already eliminated/disconnected), so it decides
  // pass/fail; this hook just carries the raw votes and the shared deadline.
  const [selfQuitVote, setSelfQuitVote] = useState(false);
  const [quitVotes, setQuitVotes] = useState<Set<string>>(new Set());
  const [quitVoteDeadline, setQuitVoteDeadline] = useState<number | null>(null);
  const quitVoteDeadlineRef = useRef<number | null>(null);
  const [incomingGarbage, setIncomingGarbage] = useState<{ amount: number; seq: number } | null>(null);
  const [eliminatedGuestIds, setEliminatedGuestIds] = useState<Set<string>>(new Set());
  // Same shape as BoardSnapshotPayload (one entry per opponent, keyed by
  // guestId) rather than a separately-declared type — see the
  // board-snapshot listener below, which just spreads the payload in.
  const [opponentBoards, setOpponentBoards] = useState<BoardSnapshotPayload[]>([]);
  // Own display name — read from localStorage after mount (same
  // hydration-safe deferred-effect shape as useColorTheme), broadcast to
  // everyone else via presence (see PresenceMeta) rather than a Postgres
  // column, matching this project's no-database-table architecture.
  const [nickname, setNicknameState] = useState('');
  // Own self-selected team (Teams mode only) — unlike nickname, deliberately
  // not persisted to localStorage; a team choice only makes sense within one
  // room's roster, not carried forward to the next room. Broadcast via
  // presence the same way (see PresenceMeta.team, retrack, setTeam below).
  const [team, setTeamState] = useState(1);
  // Whichever presence entry has isHost:true — lets any client (including a
  // guest) find the host's entry to read maxPlayers/startingLevel, and lets
  // the lobby show a "(Host)" label without a separate broadcast.
  const [hostGuestId, setHostGuestId] = useState<string | null>(null);
  const [roomSettings, setRoomSettings] = useState(DEFAULT_ROOM_SETTINGS);
  // Set true when this client's own kick listener fires — surfaced once so
  // OnlineLobby can show "you were removed" after teardown() drops it back
  // to the choose screen. Deliberately not reset by teardown() itself (a
  // kick triggers teardown internally); only a fresh joinChannel clears it.
  const [wasKicked, setWasKicked] = useState(false);
  // Set true when this client's own join attempt gets rejected for being
  // over the host's room-size cap (see the capacity check in joinChannel's
  // presence-sync handler) — same "surfaced once, only cleared by a fresh
  // joinChannel" contract as wasKicked above, and handled identically by
  // OnlineLobby (both land you back on the choose screen with a notice).
  const [roomFull, setRoomFull] = useState(false);
  // Room-scoped, not match-scoped — survives a Rematch (same conversation,
  // same room) but clears on teardown() like the rest of this list, since
  // leaving the room is leaving the conversation. Capped in setQuickChatLog
  // itself so an idle-but-connected tab can't accumulate an unbounded log.
  const [quickChatLog, setQuickChatLog] = useState<QuickChatEntry[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const guestIdRef = useRef(randomGuestId());
  const quickChatSeqRef = useRef(0);
  const garbageSeqRef = useRef(0);
  // Mirrors `opponents` so the presence-sync handler can diff against the
  // previous snapshot (a plain closure over `opponents` state would be stale
  // — this handler is wired up once per joinChannel call, not per render).
  const opponentsRef = useRef<{ guestId: string; nickname: string; team?: number }[]>([]);
  // Mirror nickname/isHost/roomSettings/joinedAt so retrack() and the
  // subscribe callback always read the latest values without needing to
  // resubscribe the channel (a plain closure over state would go stale,
  // same reasoning as opponentsRef above).
  const nicknameRef = useRef('');
  const teamRef = useRef(1);
  const isHostRef = useRef(false);
  const roomSettingsRef = useRef(DEFAULT_ROOM_SETTINGS);
  const joinedAtRef = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (saved) {
      setNicknameState(saved);
      nicknameRef.current = saved;
    }
  }, []);

  const allReady = opponents.length > 0 && opponents.every((o) => readyGuestIds.has(o.guestId));

  // Teams/Teams Co-op only: a match where every joined player picked the
  // same team has no opponent to actually play against (Teams' win check —
  // "every enemy eliminated" — would be vacuously true against an empty
  // enemy roster the instant the match started). Checked against the full
  // roster (self + opponents), not just >1 distinct value among opponents
  // alone, since a lone host sitting on Team 1 with everyone else also on
  // Team 1 is exactly the case this is meant to catch.
  const teamsConflict =
    (roomSettings.gameMode === 'teams' || roomSettings.gameMode === 'teams-coop') &&
    opponents.length > 0 &&
    new Set([team, ...opponents.map((o) => o.team ?? 1)]).size < 2;

  // Re-publishes this client's presence payload with current ref values —
  // called after nickname or (host-only) room settings change, so everyone
  // else's presence sync picks up the update. joinedAt is fixed at the
  // original join time (not "now") so retracking doesn't make it look like
  // this client just reconnected.
  const retrack = useCallback(() => {
    if (!channelRef.current) return;
    const meta: PresenceMeta = {
      nickname: nicknameRef.current,
      isHost: isHostRef.current,
      team: teamRef.current,
      ...(isHostRef.current ? roomSettingsRef.current : {}),
    };
    channelRef.current.track({ joinedAt: joinedAtRef.current, ...meta });
  }, []);

  const teardown = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setRoomCode(null);
    setIsHost(false);
    isHostRef.current = false;
    setStatus('idle');
    setOpponents([]);
    opponentsRef.current = [];
    setSelfReady(false);
    setReadyGuestIds(new Set());
    setStartAt(null);
    setMatchSeed(null);
    setMatchStartingLevel(null);
    setMatchLives(null);
    setMatchTeamCount(null);
    setIncomingGarbage(null);
    setEliminatedGuestIds(new Set());
    setOpponentBoards([]);
    setSelfQuitVote(false);
    setQuitVotes(new Set());
    setQuitVoteDeadline(null);
    quitVoteDeadlineRef.current = null;
    setHostGuestId(null);
    setRoomSettings(DEFAULT_ROOM_SETTINGS);
    roomSettingsRef.current = DEFAULT_ROOM_SETTINGS;
    setTeamState(1);
    teamRef.current = 1;
    setQuickChatLog([]);
  }, []);

  const joinChannel = useCallback((code: string, host: boolean) => {
    teardown();
    setWasKicked(false);
    setRoomFull(false);
    setRoomCode(code);
    setIsHost(host);
    isHostRef.current = host;
    setStatus('connecting');
    joinedAtRef.current = Date.now();

    const guestId = guestIdRef.current;
    const channel = supabase.channel(`tetris-room:${code}`, {
      config: { presence: { key: guestId } },
    });

    // Scoped to this one joinChannel call (a fresh closure each time, same
    // as guestId above) rather than a ref — only a guest's very first sync
    // needs the capacity check; every sync after that (settings changing,
    // people coming and going) should leave someone already properly in the
    // room alone even if the cap later drops below the current headcount.
    let capacityChecked = false;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const others = Object.keys(state)
        .filter((key) => key !== guestId)
        .map((key) => ({ guestId: key, nickname: state[key][0]?.nickname ?? '', team: state[key][0]?.team }));

      // Room size is otherwise informational (see setMaxPlayers) — this is
      // the one place it's actually enforced, and only client-side: a guest
      // checks, on its own first sync after joining, whether the room
      // (including itself) is already over the host's cap, and if so backs
      // back out. Not race-proof (two clients joining in the same instant
      // could both slip in over the cap, same "no locking" caveat as
      // quickplay's grouping), but good enough for this project's scale —
      // there's still no server to enforce it against. The host is never
      // subject to this (a host always belongs in its own room).
      if (!host && !capacityChecked) {
        capacityChecked = true;
        const hostMeta = Object.values(state).find((metas) => metas[0]?.isHost)?.[0];
        const cap = hostMeta?.maxPlayers ?? MAX_ROOM_SIZE;
        if (others.length + 1 > cap) {
          setRoomFull(true);
          teardown();
          return;
        }
      }

      // Anyone who was present a moment ago and now isn't (tab closed,
      // connection dropped) gets treated as eliminated too — otherwise a
      // player who just leaves mid-match, without ever broadcasting
      // 'eliminated' themselves, would keep the last-player-standing win
      // condition from ever resolving for whoever's left (this used to be an
      // accepted limitation; presence already tells us they're gone, so
      // there's no reason not to use it).
      const stillPresentIds = new Set(others.map((o) => o.guestId));
      const left = opponentsRef.current.filter((o) => !stillPresentIds.has(o.guestId));
      opponentsRef.current = others;
      if (left.length > 0) {
        setEliminatedGuestIds((prev) => {
          const next = new Set(prev);
          left.forEach((o) => next.add(o.guestId));
          return next;
        });
      }

      // The host's own presence entry carries the room's current settings —
      // any client (including one that just joined) can read maxPlayers/
      // startingLevel/lives straight off it instead of needing a live host to
      // rebroadcast them on request. Kept in roomSettingsRef unconditionally
      // (not just for the current host) so that if this client is the one
      // that ends up self-promoting below, it retracks with the room's real
      // last-known settings instead of whatever default this ref happened to
      // start at.
      const hostEntry = Object.entries(state).find(([, metas]) => metas[0]?.isHost);
      setHostGuestId(hostEntry?.[0] ?? null);
      if (hostEntry) {
        const meta = hostEntry[1][0];
        const nextSettings = {
          maxPlayers: meta.maxPlayers ?? MAX_ROOM_SIZE,
          startingLevel: meta.startingLevel ?? 1,
          lives: meta.lives ?? 1,
          gameMode: meta.gameMode ?? 'versus',
          sharedNextHold: meta.sharedNextHold ?? false,
          teamCount: meta.teamCount ?? 2,
        };
        setRoomSettings(nextSettings);
        roomSettingsRef.current = nextSettings;
      } else if (!isHostRef.current) {
        // No one is currently host — the original host disconnected (or was
        // kicked/left) without anyone taking over, which otherwise leaves the
        // room permanently stuck: no host means no one is ever allowed to
        // edit settings, and the host-decides-start effect below never fires
        // for anyone, so a match can never start again either. Every
        // remaining client sees the same presence snapshot, so whoever has
        // been in the room longest (earliest joinedAt, a stable tiebreak
        // available to everyone) can self-promote without negotiating with
        // the others — same no-server, compute-independently approach
        // quickplay's grouping already relies on.
        const candidates = Object.entries(state).map(([key, metas]) => ({
          guestId: key,
          joinedAt: metas[0]?.joinedAt ?? Number.MAX_SAFE_INTEGER,
        }));
        // candidates can be empty on a transient sync (e.g. one that fires
        // before this client's own track() has finished landing) — nobody
        // to self-promote yet either way, so just wait for the next sync
        // rather than let reduce() throw on an empty array.
        const earliest = candidates.length > 0 ? candidates.reduce((a, b) => (b.joinedAt < a.joinedAt ? b : a)) : null;
        if (earliest && earliest.guestId === guestId) {
          isHostRef.current = true;
          setIsHost(true);
          retrack();
          // Announced in the chat log so it doesn't just silently happen —
          // only the promoting client itself knows for sure it's the one
          // taking over (every remaining client computes "earliest" the
          // same way, so exactly one of them satisfies this branch), and it
          // broadcasts here rather than each client independently noticing
          // "hostGuestId changed" and announcing it themselves, which would
          // risk duplicate/inconsistent lines if presence is momentarily
          // out of sync across clients.
          const displayName = nicknameRef.current || guestId.slice(0, 4).toUpperCase();
          quickChatSeqRef.current += 1;
          setQuickChatLog((prev) => [...prev, { id: quickChatSeqRef.current, guestId, nickname: '', systemText: `${displayName} is now the host` }].slice(-30));
          channelRef.current?.send({
            type: 'broadcast',
            event: 'host-changed',
            payload: { displayName } satisfies HostChangedPayload,
          });
        }
      }

      setOpponents(others);
      setStatus(others.length > 0 ? 'occupied' : 'waiting');
    });

    channel.on('broadcast', { event: 'ready' }, ({ payload }: { payload: ReadyPayload }) => {
      if (payload.guestId === guestId) return;
      setReadyGuestIds((prev) => {
        const next = new Set(prev);
        if (payload.ready) next.add(payload.guestId);
        else next.delete(payload.guestId);
        return next;
      });
    });

    channel.on('broadcast', { event: 'quit-vote' }, ({ payload }: { payload: QuitVotePayload }) => {
      if (payload.guestId === guestId) return;
      setQuitVotes((prev) => {
        const next = new Set(prev);
        if (payload.voting) next.add(payload.guestId);
        else next.delete(payload.guestId);
        return next;
      });
      // Adopt whoever's deadline arrives first — if this client already has
      // one active (its own vote, or an earlier broadcast), that one wins;
      // no reconciliation needed since they're within a few ms of each other
      // either way (same "no locking, accepted small races" tradeoff as the
      // rest of this room's coordination).
      if (payload.voting && payload.deadline != null && quitVoteDeadlineRef.current === null) {
        quitVoteDeadlineRef.current = payload.deadline;
        setQuitVoteDeadline(payload.deadline);
      }
    });

    channel.on('broadcast', { event: 'start' }, ({ payload }: { payload: StartPayload }) => {
      setStartAt(payload.startAt);
      setMatchSeed(payload.seed);
      setMatchStartingLevel(payload.startingLevel);
      setMatchLives(payload.lives);
      setMatchGameMode(payload.gameMode);
      setMatchSharedNextHold(payload.sharedNextHold);
      setMatchTeamCount(payload.teamCount);
    });

    // The promoting client already appended this locally (see the
    // self-promotion branch above) — no self-guestId filter needed here
    // since that client doesn't also receive its own broadcast (self:false).
    channel.on('broadcast', { event: 'host-changed' }, ({ payload }: { payload: HostChangedPayload }) => {
      quickChatSeqRef.current += 1;
      setQuickChatLog((prev) => [...prev, { id: quickChatSeqRef.current, guestId: 'system', nickname: '', systemText: `${payload.displayName} is now the host` }].slice(-30));
    });

    channel.on('broadcast', { event: 'garbage' }, ({ payload }: { payload: GarbagePayload }) => {
      if (payload.guestId === guestId) return;
      if (payload.targetGuestId && payload.targetGuestId !== guestId) return;
      garbageSeqRef.current += 1;
      setIncomingGarbage({ amount: payload.amount, seq: garbageSeqRef.current });
    });

    channel.on('broadcast', { event: 'eliminated' }, ({ payload }: { payload: EliminatedPayload }) => {
      if (payload.guestId === guestId) return;
      setEliminatedGuestIds((prev) => new Set(prev).add(payload.guestId));
    });

    // Filtered by guestId === self, same as the other broadcasts — Supabase
    // doesn't echo a client's own send back to it (self:false is this
    // channel's default), so this filter is normally a no-op, but
    // sendQuickChat below already appends the sent message locally itself
    // (same optimistic-update pattern sendReady uses for selfReady); without
    // the filter, a config change enabling self-echo later would silently
    // start double-posting every message this client sends.
    channel.on('broadcast', { event: 'quickchat' }, ({ payload }: { payload: QuickChatPayload }) => {
      if (payload.guestId === guestId) return;
      quickChatSeqRef.current += 1;
      setQuickChatLog((prev) => [...prev, { id: quickChatSeqRef.current, ...payload }].slice(-30));
    });

    channel.on('broadcast', { event: 'board-snapshot' }, ({ payload }: { payload: BoardSnapshotPayload }) => {
      if (payload.guestId === guestId) return;
      setOpponentBoards((prev) => {
        const next = prev.filter((entry) => entry.guestId !== payload.guestId);
        // BoardSnapshotPayload and an opponentBoards entry are the same
        // shape now (guestId plus every field TetrisGame might consult) —
        // spreading avoids re-enumerating every field here as they grow.
        next.push({ ...payload });
        return next;
      });
    });

    // Host-only in practice (OnlineLobby only renders the kick control for
    // isHost), but enforced by client trust rather than a server check —
    // consistent with this project's client-authoritative architecture.
    channel.on('broadcast', { event: 'kick' }, ({ payload }: { payload: KickPayload }) => {
      if (payload.guestId !== guestId) return;
      setWasKicked(true);
      teardown();
    });

    channel.subscribe(async (subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        const meta: PresenceMeta = {
          nickname: nicknameRef.current,
          isHost: host,
          team: teamRef.current,
          ...(host ? roomSettingsRef.current : {}),
        };
        await channel.track({ joinedAt: joinedAtRef.current, ...meta });
      }
    });

    channelRef.current = channel;
  }, [teardown, retrack]);

  const createRoom = useCallback(() => {
    const code = randomRoomCode();
    joinChannel(code, true);
    return code;
  }, [joinChannel]);

  const joinRoom = useCallback((code: string) => {
    joinChannel(code.toUpperCase().trim(), false);
  }, [joinChannel]);

  // Like createRoom, but for a code that's already been agreed on elsewhere
  // (quickplay's matchmaking handshake) instead of generating a fresh one.
  const hostRoom = useCallback((code: string) => {
    joinChannel(code, true);
  }, [joinChannel]);

  const sendReady = useCallback(() => {
    setSelfReady(true);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ready',
      payload: { guestId: guestIdRef.current, ready: true } satisfies ReadyPayload,
    });
  }, []);

  // Lets a player back out before the match actually starts — the
  // host-decides-start effect below only fires once every opponent's
  // readyGuestIds entry AND this client's own selfReady are true
  // simultaneously, so an unready here genuinely blocks the countdown from
  // being triggered, not just a cosmetic toggle. Doesn't retract a countdown
  // already in flight (startAt already broadcast) — same "no locking,
  // accepted race" tradeoff as the rest of this room's coordination.
  const sendUnready = useCallback(() => {
    setSelfReady(false);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ready',
      payload: { guestId: guestIdRef.current, ready: false } satisfies ReadyPayload,
    });
  }, []);

  // Casts this client's own vote to quit — the first vote (no deadline
  // already active, checked via the ref for a synchronous read) opens the
  // QUIT_VOTE_WINDOW_MS window; every subsequent vote (this client's or a
  // received one) just joins the same window already in progress.
  const sendQuitVote = useCallback(() => {
    if (quitVoteDeadlineRef.current === null) {
      quitVoteDeadlineRef.current = Date.now() + QUIT_VOTE_WINDOW_MS;
      setQuitVoteDeadline(quitVoteDeadlineRef.current);
    }
    setSelfQuitVote(true);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'quit-vote',
      payload: { guestId: guestIdRef.current, voting: true, deadline: quitVoteDeadlineRef.current } satisfies QuitVotePayload,
    });
  }, []);

  // Retracts this client's own vote — same toggle spirit as sendUnready.
  // Doesn't itself close the window even if it leaves 0 total votes; a
  // separate effect (below) handles clearing an all-retracted window early
  // rather than letting it visibly count down to nothing.
  const retractQuitVote = useCallback(() => {
    setSelfQuitVote(false);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'quit-vote',
      payload: { guestId: guestIdRef.current, voting: false } satisfies QuitVotePayload,
    });
  }, []);

  const sendGarbage = useCallback((amount: number, targetGuestId?: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'garbage',
      payload: { guestId: guestIdRef.current, amount, targetGuestId } satisfies GarbagePayload,
    });
  }, []);

  // Broadcasts to everyone in the room (unlike sendGarbage) — there's only
  // one way to be eliminated now, and every remaining player needs to know
  // so their own "has everyone else been eliminated" count stays accurate.
  const sendEliminated = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'eliminated',
      payload: { guestId: guestIdRef.current } satisfies EliminatedPayload,
    });
  }, []);

  // Object param rather than positional args — this has grown from 5 fields
  // (board/piece position/lives) to 10 (co-op's score/level/lines/next/hold
  // on top), past the point where a positional list stays readable at the
  // call site.
  const sendBoardUpdate = useCallback((snapshot: Omit<BoardSnapshotPayload, 'guestId'>) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'board-snapshot',
      payload: { guestId: guestIdRef.current, ...snapshot } satisfies BoardSnapshotPayload,
    });
  }, []);

  // messageId indexes QUICK_CHAT_MESSAGES. Appends to this client's own log
  // immediately (self:false means the broadcast alone wouldn't do it — see
  // the quickchat listener above) rather than waiting on a round trip, so
  // sending your own message feels instant.
  const sendQuickChat = useCallback((messageId: number) => {
    const payload: QuickChatPayload = { guestId: guestIdRef.current, nickname: nicknameRef.current, messageId };
    quickChatSeqRef.current += 1;
    setQuickChatLog((prev) => [...prev, { id: quickChatSeqRef.current, ...payload }].slice(-30));
    channelRef.current?.send({ type: 'broadcast', event: 'quickchat', payload });
  }, []);

  // Clamped to 4 chars per the lobby's design (a short name that still fits
  // next to a ready-state label), persisted so it carries over to the next
  // room without retyping, and re-published immediately so anyone already in
  // the room sees the change without needing to rejoin.
  const setNickname = useCallback((next: string) => {
    const trimmed = next.slice(0, 4);
    setNicknameState(trimmed);
    nicknameRef.current = trimmed;
    localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    retrack();
  }, [retrack]);

  // Host-only in practice (OnlineLobby only renders these controls for
  // isHost) — updates local state optimistically and re-publishes via
  // presence, which is also how every other client (guests, and this host on
  // its own next presence sync) picks the change up. See PresenceMeta.
  const setMaxPlayers = useCallback((n: number) => {
    const next = { ...roomSettingsRef.current, maxPlayers: n };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  const setStartingLevel = useCallback((n: number) => {
    const next = { ...roomSettingsRef.current, startingLevel: n };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  const setLives = useCallback((n: number) => {
    const next = { ...roomSettingsRef.current, lives: n };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  const setGameMode = useCallback((m: GameMode) => {
    // Co-op's shared-board sync (see TetrisGame.tsx's isCoop adopt effect)
    // assumes exactly one partner (opponentBoards[0]) — it was never built
    // to merge N boards together. Force the room down to 2 the moment
    // Co-op is selected, same as any other host setting, rather than
    // letting a bigger room silently misbehave once a match starts. Both
    // team modes get the same treatment but derived from teamCount (2 per
    // team by default) instead of a flat constant — setTeamCount below
    // re-derives this same maxPlayers whenever teamCount itself changes
    // afterward.
    const next = {
      ...roomSettingsRef.current,
      gameMode: m,
      maxPlayers: m === 'coop' ? 2 : (m === 'teams' || m === 'teams-coop') ? roomSettingsRef.current.teamCount * 2 : roomSettingsRef.current.maxPlayers,
    };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  const setSharedNextHold = useCallback((shared: boolean) => {
    const next = { ...roomSettingsRef.current, sharedNextHold: shared };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  // Teams only — re-derives maxPlayers to 2-per-team whenever the team
  // count itself changes (same "force the dependent setting in the same
  // update" pattern setGameMode already uses for Co-op's fixed room of 2),
  // so switching from 2 to 4 teams doesn't silently leave the room capped
  // at a size too small to fit them. The host can still bump Room Size up
  // afterward via its own selector (filtered to multiples of teamCount —
  // see OnlineLobby.tsx) for more than 2 players per team.
  const setTeamCount = useCallback((n: number) => {
    const next = { ...roomSettingsRef.current, teamCount: n, maxPlayers: n * 2 };
    roomSettingsRef.current = next;
    setRoomSettings(next);
    retrack();
  }, [retrack]);

  // Self-selected (Teams mode only) — every player picks their own, not
  // host-assigned (see PresenceMeta.team). Room-scoped only, unlike
  // nickname: not persisted to localStorage, since a team choice made in
  // one room has no meaning in the next.
  const setTeam = useCallback((n: number) => {
    setTeamState(n);
    teamRef.current = n;
    retrack();
  }, [retrack]);

  // Room size is informational/advisory (shown as "N / cap" in the lobby),
  // not enforced by rejecting joins over the cap — this project deliberately
  // has no server-side gate to enforce anything against (see the "no
  // locking" architecture note), so kicking is the actual removal mechanism.
  const sendKick = useCallback((targetGuestId: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'kick',
      payload: { guestId: targetGuestId } satisfies KickPayload,
    });
  }, []);

  // Rematch: resets the ready/start/result trio back to pre-match values
  // without touching the channel/room/presence — the room stays connected so
  // everyone can just ready up again instead of re-creating it.
  const resetMatchReady = useCallback(() => {
    setSelfReady(false);
    setReadyGuestIds(new Set());
    setStartAt(null);
    setMatchSeed(null);
    setMatchStartingLevel(null);
    setMatchLives(null);
    setMatchGameMode(null);
    setMatchSharedNextHold(null);
    setMatchTeamCount(null);
    setIncomingGarbage(null);
    setEliminatedGuestIds(new Set());
    setOpponentBoards([]);
    // Also the destination for a passed quit-vote (TetrisGame calls this same
    // function either way — see its own quit-vote effect) — either path means
    // the match is over and everyone's back at this room's ready-up screen.
    setSelfQuitVote(false);
    setQuitVotes(new Set());
    setQuitVoteDeadline(null);
    quitVoteDeadlineRef.current = null;
  }, []);

  // Only the host decides + broadcasts the synchronized start time, once
  // everyone has readied up — otherwise clients would race to pick their own
  // (different) startAt. The 1.5s buffer is slack for the broadcast to
  // actually arrive before it's due; all clients (host included) just
  // schedule off the received/computed timestamp.
  useEffect(() => {
    if (isHost && selfReady && allReady && !startAt && !teamsConflict) {
      const at = Date.now() + 1500;
      const seed = Math.floor(Math.random() * 2 ** 31);
      const { startingLevel, lives, gameMode, sharedNextHold, teamCount } = roomSettingsRef.current;
      setStartAt(at);
      setMatchSeed(seed);
      setMatchStartingLevel(startingLevel);
      setMatchLives(lives);
      setMatchGameMode(gameMode);
      setMatchSharedNextHold(sharedNextHold);
      setMatchTeamCount(teamCount);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'start',
        payload: { startAt: at, seed, startingLevel, lives, gameMode, sharedNextHold, teamCount } satisfies StartPayload,
      });
    }
  }, [isHost, selfReady, allReady, startAt, teamsConflict]);

  // Closes an all-retracted vote early rather than leaving a "0 votes, still
  // counting down" window visible — every client independently notices it
  // has no votes of its own or anyone else's and clears the shared deadline,
  // no broadcast needed (each side reaches the same conclusion from the same
  // underlying ready/unready-style events).
  useEffect(() => {
    if (quitVoteDeadline !== null && !selfQuitVote && quitVotes.size === 0) {
      setQuitVoteDeadline(null);
      quitVoteDeadlineRef.current = null;
    }
  }, [selfQuitVote, quitVotes, quitVoteDeadline]);

  // Expires an unresolved vote once its window closes — a plain local timer
  // keyed off the shared deadline timestamp, same "every client schedules
  // its own timeout off one agreed-upon instant" approach the match-start
  // countdown itself already uses (see OnlineLobby.tsx). Not a broadcast:
  // every client holds the identical deadline already (see the quit-vote
  // listener/sendQuitVote above), so they all expire it independently at
  // effectively the same moment.
  useEffect(() => {
    if (quitVoteDeadline === null) return;
    const timeout = setTimeout(() => {
      setSelfQuitVote(false);
      setQuitVotes(new Set());
      setQuitVoteDeadline(null);
      quitVoteDeadlineRef.current = null;
    }, Math.max(0, quitVoteDeadline - Date.now()));
    return () => clearTimeout(timeout);
  }, [quitVoteDeadline]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    roomCode,
    isHost,
    status,
    opponents,
    selfReady,
    readyGuestIds,
    allReady,
    teamsConflict,
    startAt,
    matchSeed,
    matchStartingLevel,
    matchLives,
    matchGameMode,
    matchSharedNextHold,
    matchTeamCount,
    selfQuitVote,
    quitVotes,
    quitVoteDeadline,
    sendQuitVote,
    retractQuitVote,
    incomingGarbage,
    eliminatedGuestIds,
    opponentBoards,
    nickname,
    setNickname,
    hostGuestId,
    roomSettings,
    setMaxPlayers,
    setStartingLevel,
    setLives,
    setGameMode,
    setSharedNextHold,
    setTeamCount,
    team,
    setTeam,
    sendKick,
    wasKicked,
    roomFull,
    createRoom,
    joinRoom,
    hostRoom,
    sendReady,
    sendUnready,
    sendGarbage,
    sendEliminated,
    sendBoardUpdate,
    resetMatchReady,
    leaveRoom: teardown,
    quickChatLog,
    sendQuickChat,
  };
}
