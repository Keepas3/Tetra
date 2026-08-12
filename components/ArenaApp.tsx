'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import TetrisGame from './TetrisGame';
import { useArena } from './useArena';

// The auto-join public battle royale — no create/join/ready-up step at all,
// unlike VersusApp/OnlineLobby. Landing on /arena connects to useArena's one
// global presence channel immediately; this component just switches between
// a small waiting screen and TetrisGame depending on whether useArena has
// handed this client a round to play. See useArena.ts for the actual
// matchmaking/round-lifecycle logic and CLAUDE.md's Arena entry for the
// full design.
export default function ArenaApp() {
  const router = useRouter();
  const arena = useArena();
  // Session-scoped, not persisted — same "survives round after round, resets
  // on a full leave" convention VersusApp's winCount already established.
  const [winCount, setWinCount] = useState(0);

  const handleAttack = useCallback((amount: number) => {
    // Unlike VersusApp's per-room targeting, this picks from the FULL round
    // roster (arena.roundRoster), not just this client's own preview pod
    // (arena.podIds) — the pod split only bounds board-preview broadcast
    // fan-out, it was never meant to also shrink who you can actually fight.
    const alive = arena.roundRoster.filter((o) => o.guestId !== arena.guestId && !arena.eliminatedGuestIds.has(o.guestId));
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    arena.sendGarbage(amount, target.guestId);
  }, [arena.roundRoster, arena.eliminatedGuestIds, arena.guestId, arena.sendGarbage]);

  const opponentNicknames = Object.fromEntries(arena.roundRoster.map((o) => [o.guestId, o.nickname]));
  const enemyIds = arena.roundRoster.filter((o) => o.guestId !== arena.guestId).map((o) => o.guestId);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {!arena.roundStartAt ? (
        <div style={{
          width: '100%', maxWidth: '380px', backgroundColor: 'rgba(5,5,8,0.72)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '2rem 1.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', fontFamily: 'monospace', textAlign: 'center',
        }}>
          <h2 style={{ color: 'var(--tt-accent)', letterSpacing: '0.2em', margin: 0, fontSize: '1.1rem', textShadow: '0 0 10px color-mix(in srgb, var(--tt-accent) 50%, transparent)' }}>
            ARENA
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', letterSpacing: '0.1em', margin: 0, textTransform: 'uppercase' }}>
            Public battle royale — last one standing
          </p>
          {arena.roomFull ? (
            <p style={{ color: '#f87171', fontSize: '0.8rem', margin: '0.5rem 0' }}>
              The arena is full right now — try again in a moment.
            </p>
          ) : (
            <>
              <p style={{ color: 'white', fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0 0 0', fontVariantNumeric: 'tabular-nums' }}>
                {arena.waitingCount}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', margin: 0 }}>
                {arena.waitingCount === 1 ? 'player waiting' : 'players waiting'}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', margin: '0.5rem 0 0 0' }}>
                A round starts automatically once enough players are here.
              </p>
            </>
          )}
          {winCount > 0 && (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', margin: 0 }}>
              Wins this session: {winCount}
            </p>
          )}
          <button
            onClick={() => { arena.leaveArena(); router.push('/'); }}
            style={{ marginTop: '0.5rem', padding: '8px 24px', backgroundColor: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}
          >
            Back
          </button>
        </div>
      ) : (
        <TetrisGame
          mode="arena"
          onMenu={() => { arena.leaveArena(); router.push('/'); }}
          onRematchMenu={arena.returnToWaiting}
          onAttack={handleAttack}
          incomingGarbage={arena.incomingGarbage}
          onEliminated={arena.sendEliminated}
          eliminatedOpponentIds={Array.from(arena.eliminatedGuestIds)}
          opponentIds={arena.podIds}
          opponentNicknames={opponentNicknames}
          enemyIds={enemyIds}
          seed={arena.roundSeed ?? undefined}
          onBoardUpdate={arena.sendBoardUpdate}
          opponentBoards={arena.opponentBoards}
          onMatchWin={() => setWinCount((c) => c + 1)}
          timeBasedGravity
        />
      )}
    </div>
  );
}
