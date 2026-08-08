'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../app/utils/supabaseClient';
import { MAX_ROOM_SIZE } from './useOnlineRoom';

// Public matchmaking queue: a single well-known channel that anyone hitting
// "Quick Play" joins. Grouping is computed independently by each client from
// the same presence snapshot (sorted by joinedAt, then guestId) rather than
// negotiated, so everyone in a group always agrees on membership and roles
// without a round-trip: the sorted waiting list is chunked into consecutive
// groups of up to MAX_ROOM_SIZE, and a group forms as soon as it has >=2
// members (it doesn't wait around hoping to fill to MAX_ROOM_SIZE) — with
// exactly two concurrent searchers this is identical to simple pairing. The
// lowest-indexed member of a group is host, generates a normal room code,
// and hands it to the rest via one broadcast carrying the whole group's IDs
// — from there every member hands off into the same useOnlineRoom room flow
// a manual Create/Join would use, so this hook's only job is producing an
// agreed-on room code for an agreed-on group.
const QUICKPLAY_CHANNEL = 'tetris-quickplay-lobby';

// Same alphabet/shape as useOnlineRoom's randomRoomCode — duplicated rather
// than imported since it's a tiny pure helper and this hook has no other
// dependency on useOnlineRoom.
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

export type QuickplayStatus = 'idle' | 'searching' | 'matched';

interface MatchedPayload {
  guestId: string; // sender (the host) — broadcasts echo back to the sender
  // over Supabase Realtime, so receivers must ignore their own, same as the
  // ready/garbage/match-result guards in useOnlineRoom.ts.
  memberGuestIds: string[];
  roomCode: string;
}

export function useQuickplay() {
  const [status, setStatus] = useState<QuickplayStatus>('idle');
  const [matchedRoomCode, setMatchedRoomCode] = useState<string | null>(null);
  const [isMatchHost, setIsMatchHost] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const guestIdRef = useRef(randomGuestId());

  const leaveChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const cancelSearch = useCallback(() => {
    leaveChannel();
    setStatus('idle');
    setMatchedRoomCode(null);
    setIsMatchHost(false);
  }, [leaveChannel]);

  const search = useCallback(() => {
    leaveChannel();
    setStatus('searching');
    setMatchedRoomCode(null);
    setIsMatchHost(false);

    const guestId = guestIdRef.current;
    const channel = supabase.channel(QUICKPLAY_CHANNEL, {
      config: { presence: { key: guestId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const waiting = Object.entries(state)
        .map(([id, metas]) => ({ id, joinedAt: (metas[0] as { joinedAt?: number })?.joinedAt ?? 0 }))
        .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));

      const myIndex = waiting.findIndex((w) => w.id === guestId);
      if (myIndex === -1) return;

      const chunkStart = Math.floor(myIndex / MAX_ROOM_SIZE) * MAX_ROOM_SIZE;
      const group = waiting.slice(chunkStart, chunkStart + MAX_ROOM_SIZE);
      if (group.length < 2) return; // no one to group with yet — keep waiting

      const isHostRole = myIndex === chunkStart;
      if (isHostRole) {
        const code = randomRoomCode();
        setIsMatchHost(true);
        setMatchedRoomCode(code);
        setStatus('matched');
        channel.send({
          type: 'broadcast',
          event: 'matched',
          payload: { guestId, memberGuestIds: group.map((m) => m.id), roomCode: code } satisfies MatchedPayload,
        });
      }
      // Non-host members: don't guess a code — just wait for the host's
      // 'matched' broadcast below, so the group can never disagree.
    });

    channel.on('broadcast', { event: 'matched' }, ({ payload }: { payload: MatchedPayload }) => {
      if (payload.guestId === guestId) return; // ignore our own echoed broadcast
      if (!payload.memberGuestIds.includes(guestId)) return;
      setIsMatchHost(false);
      setMatchedRoomCode(payload.roomCode);
      setStatus('matched');
    });

    channel.subscribe(async (subscribeStatus) => {
      if (subscribeStatus === 'SUBSCRIBED') {
        await channel.track({ joinedAt: Date.now() });
      }
    });

    channelRef.current = channel;
  }, [leaveChannel]);

  // The matchmaking channel's job is done once matched — leave immediately
  // so this guestId can't be re-paired with someone else.
  useEffect(() => {
    if (status === 'matched') leaveChannel();
  }, [status, leaveChannel]);

  useEffect(() => () => leaveChannel(), [leaveChannel]);

  return { status, matchedRoomCode, isMatchHost, search, cancelSearch };
}
