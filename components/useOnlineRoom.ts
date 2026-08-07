'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../app/utils/supabaseClient';

// Phase 2: room/lobby + synchronized start over Supabase Realtime. No
// database table involved — presence + broadcast on an ad-hoc channel named
// after the room code is enough to prove two clients can find each other and
// start at the same instant. Garbage-line exchange (Phase 3) will reuse this
// same channel for gameplay events.

export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'both-present';

interface ReadyPayload {
  guestId: string;
}

interface StartPayload {
  startAt: number;
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

export function useOnlineRoom() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [status, setStatus] = useState<RoomStatus>('idle');
  const [opponentPresent, setOpponentPresent] = useState(false);
  const [selfReady, setSelfReady] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [startAt, setStartAt] = useState<number | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const guestIdRef = useRef(randomGuestId());

  const teardown = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setRoomCode(null);
    setIsHost(false);
    setStatus('idle');
    setOpponentPresent(false);
    setSelfReady(false);
    setOpponentReady(false);
    setStartAt(null);
  }, []);

  const joinChannel = useCallback((code: string, host: boolean) => {
    teardown();
    setRoomCode(code);
    setIsHost(host);
    setStatus('connecting');

    const guestId = guestIdRef.current;
    const channel = supabase.channel(`tetris-room:${code}`, {
      config: { presence: { key: guestId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const others = Object.keys(state).filter((key) => key !== guestId);
      setOpponentPresent(others.length > 0);
      setStatus(others.length > 0 ? 'both-present' : 'waiting');
    });

    channel.on('broadcast', { event: 'ready' }, ({ payload }: { payload: ReadyPayload }) => {
      if (payload.guestId !== guestId) setOpponentReady(true);
    });

    channel.on('broadcast', { event: 'start' }, ({ payload }: { payload: StartPayload }) => {
      setStartAt(payload.startAt);
    });

    channel.subscribe(async (subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        await channel.track({ joinedAt: Date.now() });
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

  const sendReady = useCallback(() => {
    setSelfReady(true);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'ready',
      payload: { guestId: guestIdRef.current } satisfies ReadyPayload,
    });
  }, []);

  // Only the host decides + broadcasts the synchronized start time, once
  // both sides have readied up — otherwise both clients would race to pick
  // their own (different) startAt. The 1.5s buffer is slack for the
  // broadcast to actually arrive before it's due; both clients (host
  // included) just schedule off the received/computed timestamp.
  useEffect(() => {
    if (isHost && selfReady && opponentReady && !startAt) {
      const at = Date.now() + 1500;
      setStartAt(at);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'start',
        payload: { startAt: at } satisfies StartPayload,
      });
    }
  }, [isHost, selfReady, opponentReady, startAt]);

  useEffect(() => () => teardown(), [teardown]);

  return {
    roomCode,
    isHost,
    status,
    opponentPresent,
    selfReady,
    opponentReady,
    startAt,
    createRoom,
    joinRoom,
    sendReady,
    leaveRoom: teardown,
  };
}
