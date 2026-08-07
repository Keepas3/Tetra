'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useOnlineRoom } from './useOnlineRoom';

interface OnlineLobbyProps {
  onStart: () => void;
  onCancel: () => void;
}

const PANEL_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: '340px',
  backgroundColor: 'rgba(5,5,8,0.72)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 10px 35px rgba(0,0,0,0.45)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  alignItems: 'stretch',
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(229,114,159,0.5)',
  border: '1px solid #e5729f',
  color: 'white',
  padding: '10px 16px',
  fontSize: '0.8rem',
  cursor: 'pointer',
  borderRadius: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: 'transparent',
  border: '1px solid rgba(255,255,255,0.25)',
  color: 'rgba(255,255,255,0.75)',
  padding: '9px 16px',
  fontSize: '0.75rem',
  cursor: 'pointer',
  borderRadius: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.15em',
};

export default function OnlineLobby({ onStart, onCancel }: OnlineLobbyProps) {
  const {
    roomCode, isHost, opponentPresent, selfReady, opponentReady, startAt,
    createRoom, joinRoom, sendReady, leaveRoom,
  } = useOnlineRoom();

  const [entryMode, setEntryMode] = useState<'choose' | 'joining'>('choose');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startAt) return;
    startedRef.current = false;

    const tick = () => setCountdownMs(Math.max(0, startAt - Date.now()));
    tick();
    const interval = setInterval(tick, 50);
    const timeout = setTimeout(() => {
      if (!startedRef.current) {
        startedRef.current = true;
        onStart();
      }
    }, Math.max(0, startAt - Date.now()));

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [startAt, onStart]);

  const handleLeave = () => {
    leaveRoom();
    onCancel();
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
        color: 'white',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', color: '#e5729f', textShadow: '0 2px 6px rgba(0,0,0,0.85), 0 0 20px rgba(229,114,159,0.8)', margin: '0 0 0.4rem 0', letterSpacing: '0.15em' }}>
          1V1 ONLINE
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.2em', fontSize: '0.75rem', margin: 0 }}>
          BETA — 40 LINES, NO GARBAGE YET
        </p>
      </div>

      <div style={PANEL_STYLE}>
        {!roomCode && entryMode === 'choose' && (
          <>
            <button style={PRIMARY_BUTTON_STYLE} onClick={() => createRoom()}>Create Room</button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={() => setEntryMode('joining')}>Join Room</button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={onCancel}>Back</button>
          </>
        )}

        {!roomCode && entryMode === 'joining' && (
          <>
            <input
              autoFocus
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase().slice(0, 5))}
              onKeyDown={(e) => { if (e.key === 'Enter' && joinCodeInput.trim().length >= 4) joinRoom(joinCodeInput); }}
              placeholder="ROOM CODE"
              maxLength={5}
              style={{
                backgroundColor: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
                color: 'white', fontSize: '1.1rem', letterSpacing: '0.3em', textAlign: 'center', padding: '10px',
                fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button
              style={{ ...PRIMARY_BUTTON_STYLE, opacity: joinCodeInput.trim().length < 4 ? 0.5 : 1 }}
              disabled={joinCodeInput.trim().length < 4}
              onClick={() => joinRoom(joinCodeInput)}
            >
              Join
            </button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={() => setEntryMode('choose')}>Back</button>
          </>
        )}

        {roomCode && (
          <>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 0.35rem 0' }}>
                Room Code
              </p>
              <p style={{ fontSize: '1.8rem', fontWeight: 'bold', letterSpacing: '0.3em', color: '#e5729f', textShadow: '0 0 12px rgba(229,114,159,0.6)', margin: 0 }}>
                {roomCode}
              </p>
              {isHost && (
                <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.5rem' }}>
                  Share this code with your opponent
                </p>
              )}
            </div>

            <p style={{ textAlign: 'center', fontSize: '0.8rem', color: opponentPresent ? '#7ee787' : 'rgba(255,255,255,0.6)', margin: 0 }}>
              {opponentPresent ? 'Opponent connected!' : 'Waiting for opponent…'}
            </p>

            {opponentPresent && !startAt && (
              <>
                <button
                  style={{ ...PRIMARY_BUTTON_STYLE, opacity: selfReady ? 0.6 : 1 }}
                  disabled={selfReady}
                  onClick={sendReady}
                >
                  {selfReady ? 'Waiting for opponent…' : 'Ready'}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  <span>You: {selfReady ? 'Ready' : 'Not ready'}</span>
                  <span>Opponent: {opponentReady ? 'Ready' : 'Not ready'}</span>
                </div>
              </>
            )}

            {startAt && countdownMs !== null && (
              <h3 style={{ textAlign: 'center', color: 'white', letterSpacing: '0.1em', margin: 0, textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>
                Starting in {(countdownMs / 1000).toFixed(1)}s
              </h3>
            )}

            <button style={SECONDARY_BUTTON_STYLE} onClick={handleLeave}>Leave Room</button>
          </>
        )}
      </div>
    </div>
  );
}
