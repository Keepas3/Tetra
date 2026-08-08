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

export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'occupied';

interface ReadyPayload {
  guestId: string;
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
  maxPlayers?: number;
  startingLevel?: number;
  lives?: number;
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
  // per-opponent without a separate broadcast.
  livesRemaining: number;
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

const NICKNAME_STORAGE_KEY = 'tetris-arena:nickname';
const DEFAULT_ROOM_SETTINGS = { maxPlayers: MAX_ROOM_SIZE, startingLevel: 1, lives: 1 };

export function useOnlineRoom() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [opponents, setOpponents] = useState<{ guestId: string; nickname: string }[]>([]);
  const [selfReady, setSelfReady] = useState(false);
  const [readyGuestIds, setReadyGuestIds] = useState<Set<string>>(new Set());
  const [startAt, setStartAt] = useState<number | null>(null);
  const [matchSeed, setMatchSeed] = useState<number | null>(null);
  const [matchStartingLevel, setMatchStartingLevel] = useState<number | null>(null);
  const [matchLives, setMatchLives] = useState<number | null>(null);
  const [incomingGarbage, setIncomingGarbage] = useState<{ amount: number; seq: number } | null>(null);
  const [eliminatedGuestIds, setEliminatedGuestIds] = useState<Set<string>>(new Set());
  const [opponentBoards, setOpponentBoards] = useState<{ guestId: string; board: number[][]; pieceMatrix: number[][]; pieceX: number; pieceY: number; livesRemaining: number }[]>([]);
  // Own display name — read from localStorage after mount (same
  // hydration-safe deferred-effect shape as useColorTheme), broadcast to
  // everyone else via presence (see PresenceMeta) rather than a Postgres
  // column, matching this project's no-database-table architecture.
  const [nickname, setNicknameState] = useState('');
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

  const channelRef = useRef<RealtimeChannel | null>(null);
  const guestIdRef = useRef(randomGuestId());
  const garbageSeqRef = useRef(0);
  // Mirrors `opponents` so the presence-sync handler can diff against the
  // previous snapshot (a plain closure over `opponents` state would be stale
  // — this handler is wired up once per joinChannel call, not per render).
  const opponentsRef = useRef<{ guestId: string; nickname: string }[]>([]);
  // Mirror nickname/isHost/roomSettings/joinedAt so retrack() and the
  // subscribe callback always read the latest values without needing to
  // resubscribe the channel (a plain closure over state would go stale,
  // same reasoning as opponentsRef above).
  const nicknameRef = useRef('');
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
    setIncomingGarbage(null);
    setEliminatedGuestIds(new Set());
    setOpponentBoards([]);
    setHostGuestId(null);
    setRoomSettings(DEFAULT_ROOM_SETTINGS);
    roomSettingsRef.current = DEFAULT_ROOM_SETTINGS;
  }, []);

  const joinChannel = useCallback((code: string, host: boolean) => {
    teardown();
    setWasKicked(false);
    setRoomCode(code);
    setIsHost(host);
    isHostRef.current = host;
    setStatus('connecting');
    joinedAtRef.current = Date.now();

    const guestId = guestIdRef.current;
    const channel = supabase.channel(`tetris-room:${code}`, {
      config: { presence: { key: guestId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const others = Object.keys(state)
        .filter((key) => key !== guestId)
        .map((key) => ({ guestId: key, nickname: state[key][0]?.nickname ?? '' }));

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
      // rebroadcast them on request.
      const hostEntry = Object.entries(state).find(([, metas]) => metas[0]?.isHost);
      setHostGuestId(hostEntry?.[0] ?? null);
      if (hostEntry) {
        const meta = hostEntry[1][0];
        const nextSettings = {
          maxPlayers: meta.maxPlayers ?? MAX_ROOM_SIZE,
          startingLevel: meta.startingLevel ?? 1,
          lives: meta.lives ?? 1,
        };
        setRoomSettings(nextSettings);
        if (isHostRef.current) roomSettingsRef.current = nextSettings;
      }

      setOpponents(others);
      setStatus(others.length > 0 ? 'occupied' : 'waiting');
    });

    channel.on('broadcast', { event: 'ready' }, ({ payload }: { payload: ReadyPayload }) => {
      if (payload.guestId === guestId) return;
      setReadyGuestIds((prev) => new Set(prev).add(payload.guestId));
    });

    channel.on('broadcast', { event: 'start' }, ({ payload }: { payload: StartPayload }) => {
      setStartAt(payload.startAt);
      setMatchSeed(payload.seed);
      setMatchStartingLevel(payload.startingLevel);
      setMatchLives(payload.lives);
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

    channel.on('broadcast', { event: 'board-snapshot' }, ({ payload }: { payload: BoardSnapshotPayload }) => {
      if (payload.guestId === guestId) return;
      setOpponentBoards((prev) => {
        const next = prev.filter((entry) => entry.guestId !== payload.guestId);
        next.push({ guestId: payload.guestId, board: payload.board, pieceMatrix: payload.pieceMatrix, pieceX: payload.pieceX, pieceY: payload.pieceY, livesRemaining: payload.livesRemaining });
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
          ...(host ? roomSettingsRef.current : {}),
        };
        await channel.track({ joinedAt: joinedAtRef.current, ...meta });
      }
    });

    channelRef.current = channel;
  }, [teardown]);

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
      payload: { guestId: guestIdRef.current } satisfies ReadyPayload,
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

  const sendBoardUpdate = useCallback((board: number[][], pieceMatrix: number[][], pieceX: number, pieceY: number, livesRemaining: number) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'board-snapshot',
      payload: { guestId: guestIdRef.current, board, pieceMatrix, pieceX, pieceY, livesRemaining } satisfies BoardSnapshotPayload,
    });
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
    setIncomingGarbage(null);
    setEliminatedGuestIds(new Set());
    setOpponentBoards([]);
  }, []);

  // Only the host decides + broadcasts the synchronized start time, once
  // everyone has readied up — otherwise clients would race to pick their own
  // (different) startAt. The 1.5s buffer is slack for the broadcast to
  // actually arrive before it's due; all clients (host included) just
  // schedule off the received/computed timestamp.
  useEffect(() => {
    if (isHost && selfReady && allReady && !startAt) {
      const at = Date.now() + 1500;
      const seed = Math.floor(Math.random() * 2 ** 31);
      const { startingLevel, lives } = roomSettingsRef.current;
      setStartAt(at);
      setMatchSeed(seed);
      setMatchStartingLevel(startingLevel);
      setMatchLives(lives);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'start',
        payload: { startAt: at, seed, startingLevel, lives } satisfies StartPayload,
      });
    }
  }, [isHost, selfReady, allReady, startAt]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    roomCode,
    isHost,
    status,
    opponents,
    selfReady,
    readyGuestIds,
    allReady,
    startAt,
    matchSeed,
    matchStartingLevel,
    matchLives,
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
    sendKick,
    wasKicked,
    createRoom,
    joinRoom,
    hostRoom,
    sendReady,
    sendGarbage,
    sendEliminated,
    sendBoardUpdate,
    resetMatchReady,
    leaveRoom: teardown,
  };
}
