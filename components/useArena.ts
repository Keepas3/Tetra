'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../app/utils/supabaseClient';
import { NICKNAME_STORAGE_KEY } from './useOnlineRoom';

// Arena: land on /arena, get auto-joined to whoever else is there, and play
// round after round with no create/join/ready-up step at all — the opposite
// of useOnlineRoom's model, which is why this is a separate hook rather than
// a mode grafted onto it. See CLAUDE.md's Arena entry for the full design;
// the short version:
//
// - One global presence channel (ARENA_CHANNEL) is EVERYONE currently on the
//   page, capped at ARENA_MAX_PLAYERS (same client-side soft-cap pattern as
//   useOnlineRoom's roomFull). A player's own presence entry carries
//   `roundId: null` while waiting, or the id of whichever round they're
//   currently playing — this is the ONLY thing that distinguishes "waiting"
//   from "playing," no separate list is kept.
// - No persistent host. The "coordinator" for the next round is whoever has
//   the earliest joinedAt among the CURRENTLY WAITING pool, recomputed fresh
//   on every presence sync (not elected once) — since the coordinator is
//   always part of the round they themselves propose, the moment their round
//   actually starts they leave the waiting pool too, and the role passes to
//   whoever's next automatically. Once >=2 are waiting, that client starts a
//   15s local settle timer (or fires immediately at ARENA_MAX_PLAYERS) and
//   broadcasts a `round-start` with a snapshot of the current waiting roster.
//   Multiple rounds can be in flight at once for different, non-overlapping
//   subsets of players — nothing here tries to enforce "exactly one active
//   round," each client's own match is independent either way.
// - Garbage/eliminated broadcasts stay on the one global channel (low
//   frequency — bounded by line clears and topouts, not a tick) — but the
//   frequent ~200ms board-preview broadcast does NOT: at 100 players an
//   all-to-all preview channel would be ~50,000 message deliveries/sec (see
//   the CLAUDE.md entry for the math). Instead, once a round's roster is
//   locked in, every client in it deterministically computes the same
//   ARENA_POD_SIZE-sized "pod" from that shared roster (sort by guestId,
//   chunk — the same technique useQuickplay.ts already uses to group
//   strangers) and opens a second, round-scoped channel just for that pod's
//   preview broadcasts — bounding fan-out to pod-size^2, the same scale as
//   an existing small room.

export const ARENA_MAX_PLAYERS = 100;
export const ARENA_POD_SIZE = 10;
export const ARENA_START_DELAY_MS = 15_000;
// Buffer between a round-start broadcast landing and the match actually
// beginning — same idea as useOnlineRoom's 1.5s buffer, just a bit more
// generous since a round can involve far more clients needing the broadcast
// (and a fresh pod-channel subscription) to land in time.
const ARENA_ROUND_START_BUFFER_MS = 3000;

const ARENA_CHANNEL_NAME = 'tetris-arena';

interface RosterEntry {
  guestId: string;
  nickname: string;
}

interface ArenaPresenceMeta {
  nickname: string;
  joinedAt: number;
  // null = waiting for the next round; otherwise the id of whichever round
  // this player is currently playing. This single field is the entire
  // "waiting vs. playing" state machine — see the file header.
  roundId: string | null;
}

interface RoundStartPayload {
  roundId: string;
  startAt: number;
  seed: number;
  roster: RosterEntry[];
}

interface ArenaGarbagePayload {
  guestId: string;
  amount: number;
  targetGuestId?: string;
}

interface ArenaEliminatedPayload {
  guestId: string;
}

// Same shape as TetrisGame's own BoardSnapshot (minus the teams-coop-only
// fields it never sets here — they're optional on that type, so omitting
// them is fine) — kept as a plain local interface rather than importing
// TetrisGame's, since this file has no reason to depend on that component.
interface ArenaBoardSnapshotPayload {
  guestId: string;
  board: number[][];
  pieceMatrix: number[][];
  pieceX: number;
  pieceY: number;
  livesRemaining: number;
  score: number;
  level: number;
  lines: number;
  next: number[];
  hold: number | null;
  lockedPieceMatrix?: number[][];
  lockedPieceX?: number;
  lockedPieceY?: number;
}

function randomGuestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function randomRoundId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Deterministic pod assignment — every client in `roster` computes the exact
// same chunking independently (sort by guestId, slice into ARENA_POD_SIZE
// groups), so there's nothing to negotiate. Returns this client's podmates'
// ids (self excluded) and a stable pod index used to name the pod channel.
function computePod(roster: RosterEntry[], selfGuestId: string): { podIndex: number; podGuestIds: string[] } {
  const sortedIds = roster.map((r) => r.guestId).sort();
  const myIndex = sortedIds.indexOf(selfGuestId);
  const podIndex = Math.max(0, Math.floor(myIndex / ARENA_POD_SIZE));
  const podGuestIds = sortedIds.slice(podIndex * ARENA_POD_SIZE, podIndex * ARENA_POD_SIZE + ARENA_POD_SIZE).filter((id) => id !== selfGuestId);
  return { podIndex, podGuestIds };
}

export function useArena() {
  const [waitingCount, setWaitingCount] = useState(0);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [roundStartAt, setRoundStartAt] = useState<number | null>(null);
  const [roundSeed, setRoundSeed] = useState<number | null>(null);
  const [roundRoster, setRoundRoster] = useState<RosterEntry[]>([]);
  const [podIds, setPodIds] = useState<string[]>([]);
  const [incomingGarbage, setIncomingGarbage] = useState<{ amount: number; seq: number } | null>(null);
  const [eliminatedGuestIds, setEliminatedGuestIds] = useState<Set<string>>(new Set());
  const [opponentBoards, setOpponentBoards] = useState<(ArenaBoardSnapshotPayload)[]>([]);
  const [roomFull, setRoomFull] = useState(false);
  const [nickname, setNicknameState] = useState('');

  // A stable identity, generated once via useState's lazy initializer rather
  // than a plain useRef(randomGuestId()) — the hook's own return value needs
  // to expose it, and reading a ref's .current during render (as opposed to
  // inside an effect/callback) trips the React Compiler's refs-during-render
  // rule. guestIdRef below just mirrors it for the many internal
  // callbacks/effects that already read guestIdRef.current, unchanged.
  const [guestId] = useState(() => randomGuestId());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const podChannelRef = useRef<RealtimeChannel | null>(null);
  const guestIdRef = useRef(guestId);
  const nicknameRef = useRef('');
  // Set to the real timestamp inside the connecting effect below, not here —
  // Date.now() is impure, and useOnlineRoom.ts's own joinedAtRef establishes
  // the same "initialize to a static placeholder, assign the real value
  // inside a callback/effect" pattern for the identical reason.
  const joinedAtRef = useRef(0);
  const roundIdRef = useRef<string | null>(null);
  // Mirrors roundRoster for the presence-sync handler below, which is wired
  // up once inside the connecting effect (deps [guestId, applyRoundStart,
  // proposeRound]) and would otherwise read a stale empty roster forever —
  // same "ref mirror for a closure that only runs once" pattern already
  // established in this codebase (e.g. TetrisGame.tsx's opponentBoardsRef).
  const roundRosterRef = useRef<RosterEntry[]>([]);
  const garbageSeqRef = useRef(0);
  // Freshest computed waiting pool, kept current every presence sync so the
  // coordinator's settle-timer callback (which fires later, off a stale
  // closure otherwise) reads the roster as of when it actually fires, not
  // as of when the timer was scheduled.
  const waitingPoolRef = useRef<RosterEntry[]>([]);
  // Set once this client detects it's the coordinator with >=2 waiting; null
  // otherwise. Guards against restarting the 15s window on every subsequent
  // presence sync (which would push the start out forever under steady
  // traffic) — same "first event sets it, nothing after does" shape as
  // useOnlineRoom's quitVoteDeadline.
  const coordinatorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(NICKNAME_STORAGE_KEY);
    if (saved) {
      setNicknameState(saved);
      nicknameRef.current = saved;
    }
  }, []);

  const retrackSelf = useCallback(() => {
    channelRef.current?.track({
      nickname: nicknameRef.current,
      joinedAt: joinedAtRef.current,
      roundId: roundIdRef.current,
    } satisfies ArenaPresenceMeta);
  }, []);

  // Applied both when this client itself proposes a round (so the proposer
  // doesn't need its own broadcast echoed back, which Supabase doesn't do by
  // default) and when a round-start broadcast from someone else arrives —
  // one shared code path so both cases can never drift apart.
  const applyRoundStart = useCallback((payload: RoundStartPayload) => {
    if (roundIdRef.current !== null) return; // already mid-round, ignore
    if (!payload.roster.some((r) => r.guestId === guestIdRef.current)) return;

    roundIdRef.current = payload.roundId;
    setRoundId(payload.roundId);
    setRoundStartAt(payload.startAt);
    setRoundSeed(payload.seed);
    setRoundRoster(payload.roster);
    roundRosterRef.current = payload.roster;
    // Scoped fresh per round — a stale guestId eliminated in an earlier
    // round must not falsely satisfy this round's last-standing check (the
    // exact bug Teams' host-migration fix had to correct for the same
    // reason, see CLAUDE.md).
    setEliminatedGuestIds(new Set());
    setOpponentBoards([]);

    const { podIndex, podGuestIds } = computePod(payload.roster, guestIdRef.current);
    setPodIds(podGuestIds);

    if (podChannelRef.current) supabase.removeChannel(podChannelRef.current);
    const podChannel = supabase.channel(`tetris-arena-pod:${payload.roundId}:${podIndex}`);
    podChannel.on('broadcast', { event: 'board-snapshot' }, ({ payload: snap }: { payload: ArenaBoardSnapshotPayload }) => {
      if (snap.guestId === guestIdRef.current) return;
      setOpponentBoards((prev) => [...prev.filter((b) => b.guestId !== snap.guestId), snap]);
    });
    podChannel.subscribe();
    podChannelRef.current = podChannel;

    retrackSelf();
  }, [retrackSelf]);

  // Broadcasts a round-start for the given roster and applies it locally —
  // the shared "propose a round" action, called either off the settle timer
  // or immediately once the waiting pool hits capacity.
  const proposeRound = useCallback((roster: RosterEntry[]) => {
    const payload: RoundStartPayload = {
      roundId: randomRoundId(),
      startAt: Date.now() + ARENA_ROUND_START_BUFFER_MS,
      seed: Math.floor(Math.random() * 2 ** 31),
      roster: roster.slice(0, ARENA_MAX_PLAYERS),
    };
    coordinatorTimerRef.current = null;
    channelRef.current?.send({ type: 'broadcast', event: 'round-start', payload });
    applyRoundStart(payload);
  }, [applyRoundStart]);

  useEffect(() => {
    joinedAtRef.current = Date.now();
    const channel = supabase.channel(ARENA_CHANNEL_NAME, {
      config: { presence: { key: guestId } },
    });

    let capacityChecked = false;
    let coordinatorDeadline: number | null = null;
    let settleTimeout: ReturnType<typeof setTimeout> | null = null;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<ArenaPresenceMeta>();
      const entries = Object.keys(state).map((key) => ({
        guestId: key,
        nickname: state[key][0]?.nickname ?? '',
        joinedAt: state[key][0]?.joinedAt ?? Number.MAX_SAFE_INTEGER,
        roundId: state[key][0]?.roundId ?? null,
      }));

      // Same "self-eject on my own first sync if over cap" pattern as
      // useOnlineRoom's roomFull — no server to enforce it against, good
      // enough at this project's scale (see its own comment for the
      // race caveat).
      if (!capacityChecked) {
        capacityChecked = true;
        if (entries.length > ARENA_MAX_PLAYERS) {
          setRoomFull(true);
          supabase.removeChannel(channel);
          return;
        }
      }

      // Disconnects count as eliminations here too, same reasoning as
      // useOnlineRoom's presence-diff — otherwise a round's last-standing
      // check could stall forever against a player who just closed their
      // tab without ever broadcasting 'eliminated'. Simpler than
      // useOnlineRoom's version: no need to diff against a "previous
      // snapshot," just check every current round-roster member (besides
      // self) against who's actually still present — re-adding an already-
      // eliminated id to the Set is a harmless no-op, so this can run on
      // every sync unconditionally.
      if (roundRosterRef.current.length > 0) {
        const presentIds = new Set(entries.map((e) => e.guestId));
        const missing = roundRosterRef.current.filter((r) => r.guestId !== guestId && !presentIds.has(r.guestId));
        if (missing.length > 0) {
          setEliminatedGuestIds((prev) => {
            const next = new Set(prev);
            missing.forEach((r) => next.add(r.guestId));
            return next;
          });
        }
      }

      const waiting = entries
        .filter((e) => e.roundId === null)
        .sort((a, b) => (a.joinedAt - b.joinedAt) || a.guestId.localeCompare(b.guestId));
      waitingPoolRef.current = waiting;
      setWaitingCount(waiting.length);

      const amICoordinator = roundIdRef.current === null && waiting.length > 0 && waiting[0].guestId === guestId;

      if (amICoordinator && waiting.length >= ARENA_MAX_PLAYERS) {
        if (settleTimeout) { clearTimeout(settleTimeout); settleTimeout = null; }
        coordinatorDeadline = null;
        proposeRound(waitingPoolRef.current);
      } else if (amICoordinator && waiting.length >= 2 && coordinatorDeadline === null) {
        coordinatorDeadline = Date.now() + ARENA_START_DELAY_MS;
        settleTimeout = setTimeout(() => {
          settleTimeout = null;
          coordinatorDeadline = null;
          proposeRound(waitingPoolRef.current);
        }, ARENA_START_DELAY_MS);
      } else if (!amICoordinator && settleTimeout) {
        // Someone with an earlier joinedAt is now waiting too (they just
        // returned from a round) — defer to them rather than double-propose.
        clearTimeout(settleTimeout);
        settleTimeout = null;
        coordinatorDeadline = null;
      }
    });

    channel.on('broadcast', { event: 'round-start' }, ({ payload }: { payload: RoundStartPayload }) => {
      applyRoundStart(payload);
    });

    channel.on('broadcast', { event: 'garbage' }, ({ payload }: { payload: ArenaGarbagePayload }) => {
      if (payload.guestId === guestId) return;
      if (payload.targetGuestId && payload.targetGuestId !== guestId) return;
      garbageSeqRef.current += 1;
      setIncomingGarbage({ amount: payload.amount, seq: garbageSeqRef.current });
    });

    channel.on('broadcast', { event: 'eliminated' }, ({ payload }: { payload: ArenaEliminatedPayload }) => {
      if (payload.guestId === guestId) return;
      setEliminatedGuestIds((prev) => new Set(prev).add(payload.guestId));
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ nickname: nicknameRef.current, joinedAt: joinedAtRef.current, roundId: null } satisfies ArenaPresenceMeta);
      }
    });

    channelRef.current = channel;

    return () => {
      if (settleTimeout) clearTimeout(settleTimeout);
      supabase.removeChannel(channel);
      if (podChannelRef.current) supabase.removeChannel(podChannelRef.current);
      channelRef.current = null;
      podChannelRef.current = null;
    };
  }, [guestId, applyRoundStart, proposeRound]);

  const sendGarbage = useCallback((amount: number, targetGuestId?: string) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'garbage',
      payload: { guestId: guestIdRef.current, amount, targetGuestId } satisfies ArenaGarbagePayload,
    });
  }, []);

  const sendEliminated = useCallback(() => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'eliminated',
      payload: { guestId: guestIdRef.current } satisfies ArenaEliminatedPayload,
    });
  }, []);

  // Pod-scoped, unlike useOnlineRoom's sendBoardUpdate — this is the whole
  // point of the pod split, see the file header.
  const sendBoardUpdate = useCallback((snapshot: Omit<ArenaBoardSnapshotPayload, 'guestId'>) => {
    podChannelRef.current?.send({
      type: 'broadcast',
      event: 'board-snapshot',
      payload: { guestId: guestIdRef.current, ...snapshot } satisfies ArenaBoardSnapshotPayload,
    });
  }, []);

  // Called once this client's own match concludes (win or loss) and the
  // result screen has run its course (see TetrisGame's arena auto-return
  // effect) — tears down the pod channel and rejoins the waiting pool for
  // whichever round gets proposed next. Deliberately not automatic the
  // instant the match ends: the result screen gets a beat to actually show.
  const returnToWaiting = useCallback(() => {
    if (podChannelRef.current) {
      supabase.removeChannel(podChannelRef.current);
      podChannelRef.current = null;
    }
    roundIdRef.current = null;
    roundRosterRef.current = [];
    setRoundId(null);
    setRoundStartAt(null);
    setRoundSeed(null);
    setRoundRoster([]);
    setPodIds([]);
    setOpponentBoards([]);
    setIncomingGarbage(null);
    setEliminatedGuestIds(new Set());
    retrackSelf();
  }, [retrackSelf]);

  // Full leave — navigating away from /arena entirely, not just between
  // rounds. Unlike useOnlineRoom's teardown, there's no "room" to tear down,
  // just this client's own channels; the effect's own cleanup (above)
  // already handles that on unmount, so this only needs to exist as a named
  // action for ArenaApp's onMenu to call before navigating.
  const leaveArena = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (podChannelRef.current) supabase.removeChannel(podChannelRef.current);
    channelRef.current = null;
    podChannelRef.current = null;
  }, []);

  return {
    guestId,
    nickname,
    waitingCount,
    roundId,
    roundStartAt,
    roundSeed,
    roundRoster,
    podIds,
    incomingGarbage,
    eliminatedGuestIds,
    opponentBoards,
    roomFull,
    sendGarbage,
    sendEliminated,
    sendBoardUpdate,
    returnToWaiting,
    leaveArena,
  };
}
