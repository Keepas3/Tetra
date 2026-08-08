'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import OnlineLobby from './OnlineLobby';
import TetrisGame from './TetrisGame';
import { useOnlineRoom } from './useOnlineRoom';
import { useQuickplay } from './useQuickplay';

interface VersusAppProps {
  initialRoomCode?: string;
}

export default function VersusApp({ initialRoomCode }: VersusAppProps) {
  const [view, setView] = useState<'LOBBY' | 'PLAYING'>('LOBBY');
  const router = useRouter();
  // Owned here (not inside OnlineLobby) so the Realtime channel survives the
  // LOBBY -> PLAYING handoff and stays alive for garbage/match-result
  // broadcasts during the match.
  const room = useOnlineRoom();
  const quickplay = useQuickplay();
  // Snapshot of who's in the match, taken the instant it starts — room.opponents
  // is live presence and could shift mid-match (e.g. someone's tab closing),
  // but the last-player-standing win condition needs a denominator that can't
  // move under a running match. Re-snapshots naturally on every rematch too,
  // since onStart fires again each time.
  const [matchOpponents, setMatchOpponents] = useState<{ guestId: string }[]>([]);
  // Session-scoped, not persisted — resets on a full leave (Quit) but
  // survives rematches, since staying in the same room is exactly when a
  // running count should keep counting.
  const [winCount, setWinCount] = useState(0);

  const handleAttack = useCallback((amount: number) => {
    const alive = matchOpponents.filter((o) => !room.eliminatedGuestIds.has(o.guestId));
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    room.sendGarbage(amount, target.guestId);
  }, [matchOpponents, room.eliminatedGuestIds, room.sendGarbage]);

  // Once quickplay groups strangers onto a room code, hand off into the
  // same room flow a manual Create/Join uses — quickplay's only job was
  // agreeing on that code.
  useEffect(() => {
    if (quickplay.status !== 'matched' || !quickplay.matchedRoomCode) return;
    if (quickplay.isMatchHost) room.hostRoom(quickplay.matchedRoomCode);
    else room.joinRoom(quickplay.matchedRoomCode);
  }, [quickplay.status, quickplay.matchedRoomCode, quickplay.isMatchHost, room.hostRoom, room.joinRoom]);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {view === 'LOBBY' && (
        <OnlineLobby
          // Only needed to auto-join once, on the very first arrival via a
          // shared link — once room.roomCode is set it stays set for this
          // component's whole lifetime, so this also prevents a rematch's
          // repeated OnlineLobby mounts from re-triggering a join.
          initialCode={room.roomCode ? undefined : initialRoomCode}
          onStart={() => { setMatchOpponents(room.opponents); setView('PLAYING'); }}
          onCancel={() => router.push('/')}
          roomCode={room.roomCode}
          isHost={room.isHost}
          opponents={room.opponents}
          selfReady={room.selfReady}
          readyGuestIds={room.readyGuestIds}
          startAt={room.startAt}
          createRoom={room.createRoom}
          joinRoom={room.joinRoom}
          sendReady={room.sendReady}
          leaveRoom={room.leaveRoom}
          quickplayStatus={quickplay.status}
          onQuickplaySearch={quickplay.search}
          onQuickplayCancel={quickplay.cancelSearch}
          winCount={winCount}
          nickname={room.nickname}
          setNickname={room.setNickname}
          hostGuestId={room.hostGuestId}
          roomSettings={room.roomSettings}
          setMaxPlayers={room.setMaxPlayers}
          setStartingLevel={room.setStartingLevel}
          setLives={room.setLives}
          sendKick={room.sendKick}
          wasKicked={room.wasKicked}
        />
      )}

      {/* Quit (onMenu) fully leaves the room. Rematch (onRematchMenu) only
          resets the ready/start state and returns to the same still-connected
          room's lobby, so both players can ready up again without recreating
          anything. */}
      {view === 'PLAYING' && (
        <TetrisGame
          mode="versus"
          onMenu={() => { room.leaveRoom(); setWinCount(0); setView('LOBBY'); }}
          onRematchMenu={() => { room.resetMatchReady(); setView('LOBBY'); }}
          onAttack={handleAttack}
          incomingGarbage={room.incomingGarbage}
          onEliminated={room.sendEliminated}
          eliminatedOpponentIds={Array.from(room.eliminatedGuestIds)}
          opponentCount={matchOpponents.length}
          opponentIds={matchOpponents.map((o) => o.guestId)}
          seed={room.matchSeed ?? undefined}
          startingLevel={room.matchStartingLevel ?? undefined}
          lives={room.matchLives ?? undefined}
          onBoardUpdate={room.sendBoardUpdate}
          opponentBoards={room.opponentBoards}
          onMatchWin={() => setWinCount((c) => c + 1)}
        />
      )}
    </div>
  );
}
