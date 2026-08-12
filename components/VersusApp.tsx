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
  const [matchOpponents, setMatchOpponents] = useState<{ guestId: string; nickname: string; team?: number }[]>([]);
  // Teams only — this client's own team, snapshotted alongside matchOpponents
  // for the same reason (there's no UI to change it mid-match, but matching
  // the "everything the match logic reads is locked in at start" convention
  // the rest of this snapshot already follows is cheap and one less thing to
  // reason about later).
  const [matchSelfTeam, setMatchSelfTeam] = useState(1);
  // Session-scoped, not persisted — resets on a full leave (Quit) but
  // survives rematches, since staying in the same room is exactly when a
  // running count should keep counting.
  const [winCount, setWinCount] = useState(0);
  // A voluntary Quit tears down the room (room.roomCode -> null), which
  // would otherwise make `initialCode` below fall back to initialRoomCode
  // again — and initialRoomCode (from a /versus?code=XXX link) never
  // clears itself, since the URL doesn't change. Without this flag, a
  // player who joined via a shared link and hits Quit mid-match gets
  // silently auto-rejoined into that same still-running room by
  // OnlineLobby's own auto-join effect (its guard against re-firing is a
  // ref scoped to one OnlineLobby mount, and Quit remounts it) — landing
  // back on a Ready button for a match that already started without them.
  // Quit is a deliberate "I'm done," so once it happens the link should
  // never resurrect that room again for the rest of this page's lifetime.
  const [hasQuit, setHasQuit] = useState(false);

  const handleAttack = useCallback((amount: number) => {
    // Teams-coop: a team shares one board, so an attack has to reach EVERY
    // member of the target team (not one random individual, the way Teams
    // itself does below) — otherwise their shared board would desync the
    // moment one teammate's pendingGarbageRef gets it and another's
    // doesn't. Pick one random still-alive enemy team ("alive" = at least
    // one member not yet eliminated — teams-coop's members converge to all-
    // eliminated together once the shared board is truly out of lives, but
    // not necessarily simultaneously, see TetrisGame.tsx's win-condition
    // comment), then broadcast to every one of its members.
    if (room.matchGameMode === 'teams-coop') {
      const enemyTeams = Array.from(new Set(matchOpponents.filter((o) => o.team !== matchSelfTeam).map((o) => o.team ?? 1)));
      const aliveEnemyTeams = enemyTeams.filter((t) =>
        matchOpponents.some((o) => o.team === t && !room.eliminatedGuestIds.has(o.guestId))
      );
      if (aliveEnemyTeams.length === 0) return;
      const targetTeam = aliveEnemyTeams[Math.floor(Math.random() * aliveEnemyTeams.length)];
      matchOpponents.filter((o) => o.team === targetTeam).forEach((o) => room.sendGarbage(amount, o.guestId));
      return;
    }

    // Teams: never a teammate — only players on a different team than this
    // client's own (matchSelfTeam) are ever valid targets. Versus/Practice
    // (team field never set) fall through unfiltered exactly as before.
    const eligible = matchOpponents.filter((o) => room.matchGameMode !== 'teams' || o.team !== matchSelfTeam);
    const alive = eligible.filter((o) => !room.eliminatedGuestIds.has(o.guestId));
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    room.sendGarbage(amount, target.guestId);
  }, [matchOpponents, matchSelfTeam, room.matchGameMode, room.eliminatedGuestIds, room.sendGarbage]);

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
          initialCode={hasQuit ? undefined : (room.roomCode ? undefined : initialRoomCode)}
          onStart={() => { setMatchOpponents(room.opponents); setMatchSelfTeam(room.team); setView('PLAYING'); }}
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
          sendUnready={room.sendUnready}
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
          setGameMode={room.setGameMode}
          setSharedNextHold={room.setSharedNextHold}
          setTeamCount={room.setTeamCount}
          team={room.team}
          setTeam={room.setTeam}
          sendKick={room.sendKick}
          wasKicked={room.wasKicked}
          roomFull={room.roomFull}
          quickChatLog={room.quickChatLog}
          sendQuickChat={room.sendQuickChat}
          teamsConflict={room.teamsConflict}
        />
      )}

      {/* onMenu (full leave) is required by TetrisGameProps for solo modes,
          but is effectively unreachable here now: TetrisGame only calls it
          from a room-aware match when isMultiplayerRoom is false, and every
          mode VersusApp ever renders (versus/practice) is multiplayer. Mid-
          match Quit is a group vote instead (quitVotes/selfQuitVote/
          onQuitVote/onRetractQuitVote below) — a passed vote reuses
          onRematchMenu, same as the post-match "Rematch" button, since both
          mean "keep this room alive, go back to its lobby." Kept wired to
          the same full-leave function anyway as a safe fallback rather than
          a no-op, in case a future path ever does reach it. */}
      {view === 'PLAYING' && (
        <TetrisGame
          mode={room.matchGameMode === 'practice' ? 'practice' : room.matchGameMode === 'coop' ? 'coop' : room.matchGameMode === 'teams' ? 'teams' : room.matchGameMode === 'teams-coop' ? 'teams-coop' : 'versus'}
          onMenu={() => { room.leaveRoom(); setWinCount(0); setHasQuit(true); setView('LOBBY'); }}
          onRematchMenu={() => { room.resetMatchReady(); setView('LOBBY'); }}
          onAttack={handleAttack}
          incomingGarbage={room.incomingGarbage}
          onEliminated={room.sendEliminated}
          eliminatedOpponentIds={Array.from(room.eliminatedGuestIds)}
          opponentIds={matchOpponents.map((o) => o.guestId)}
          opponentNicknames={Object.fromEntries(matchOpponents.map((o) => [o.guestId, o.nickname]))}
          // Both team modes — the win-condition effect watches this (not
          // opponentIds, which stays "everyone else" so the preview column
          // can still show teammates) for "has every enemy been eliminated."
          // opponentTeams feeds the preview column's own team grouping.
          enemyIds={(room.matchGameMode === 'teams' || room.matchGameMode === 'teams-coop') ? matchOpponents.filter((o) => o.team !== matchSelfTeam).map((o) => o.guestId) : undefined}
          opponentTeams={(room.matchGameMode === 'teams' || room.matchGameMode === 'teams-coop') ? Object.fromEntries(matchOpponents.map((o) => [o.guestId, o.team ?? 1])) : undefined}
          selfTeam={(room.matchGameMode === 'teams' || room.matchGameMode === 'teams-coop') ? matchSelfTeam : undefined}
          seed={room.matchSeed ?? undefined}
          startingLevel={room.matchStartingLevel ?? undefined}
          lives={room.matchLives ?? undefined}
          sharedNextHold={room.matchSharedNextHold ?? undefined}
          onBoardUpdate={room.sendBoardUpdate}
          opponentBoards={room.opponentBoards}
          onMatchWin={() => setWinCount((c) => c + 1)}
          quitVotes={room.quitVotes}
          selfQuitVote={room.selfQuitVote}
          quitVoteDeadline={room.quitVoteDeadline}
          onQuitVote={room.sendQuitVote}
          onRetractQuitVote={room.retractQuitVote}
        />
      )}
    </div>
  );
}
