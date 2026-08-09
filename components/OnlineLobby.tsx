'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MAX_ROOM_SIZE, QUICK_CHAT_MESSAGES, type QuickChatEntry } from './useOnlineRoom';
import ControlsSettings from './ControlsSettings';

// Guideline-style speed curve tops out well before this (see
// calculateDropInterval in TetrisGame.tsx) — 15 is already close to instant
// drop, so it's a sane ceiling for the picker rather than an arbitrary cap.
const MAX_STARTING_LEVEL = 15;
// Sandbox-scale ceiling on extra lives — enough for a "keep playing" cushion
// without turning last-player-standing into an endurance grind.
const MAX_LIVES = 5;

interface OnlineLobbyProps {
  onStart: () => void;
  onCancel: () => void;
  // Pre-fills and auto-joins from a shared link's ?code= param, skipping the
  // Create/Join choice screen entirely.
  initialCode?: string;
  // Room state/actions — owned by VersusApp (via useOnlineRoom) rather than
  // this component, so the same Realtime channel survives the handoff into
  // TetrisGame once the match starts (needed for garbage exchange).
  roomCode: string | null;
  isHost: boolean;
  opponents: { guestId: string; nickname: string }[];
  selfReady: boolean;
  readyGuestIds: Set<string>;
  startAt: number | null;
  createRoom: () => string;
  joinRoom: (code: string) => void;
  sendReady: () => void;
  leaveRoom: () => void;
  // Public matchmaking queue — owned by VersusApp (via useQuickplay), same
  // "hooks that outlive this component live in the parent" pattern as room.
  quickplayStatus: 'idle' | 'searching' | 'matched';
  onQuickplaySearch: () => void;
  onQuickplayCancel: () => void;
  // Session stats — also owned by VersusApp (survives TetrisGame's per-match
  // remounts). Shown here rather than on TetrisGame's result screen so it's
  // visible right where you'd decide whether to keep playing; room for more
  // (APM, etc.) to land alongside it later without touching the match screen.
  winCount: number;
  // Own display name, shown in the player list instead of a truncated guest
  // id — settable any time, not just before joining, since it's broadcast
  // live via presence (see useOnlineRoom).
  nickname: string;
  setNickname: (n: string) => void;
  // Whichever opponent (or self) is hosting — drives the "(Host)" label and
  // gates the host-only settings/kick controls below.
  hostGuestId: string | null;
  roomSettings: { maxPlayers: number; startingLevel: number; lives: number };
  setMaxPlayers: (n: number) => void;
  setStartingLevel: (n: number) => void;
  setLives: (n: number) => void;
  // Host-only removal — informational room-size cap doesn't reject joins on
  // its own (see useOnlineRoom), so this is the actual enforcement tool.
  sendKick: (guestId: string) => void;
  // True right after this client's own kick listener fires — shown once on
  // the choose screen (teardown already dropped roomCode back to null by
  // the time this renders).
  wasKicked: boolean;
  // Room-scoped preset chat (see QUICK_CHAT_MESSAGES in useOnlineRoom) —
  // only shown once actually in a room, there's no one to talk to before that.
  quickChatLog: QuickChatEntry[];
  sendQuickChat: (messageId: number) => void;
}

const PANEL_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: '380px',
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
  backgroundColor: 'color-mix(in srgb, var(--tt-accent) 50%, transparent)',
  border: '1px solid var(--tt-accent)',
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

const NICKNAME_INPUT_STYLE: React.CSSProperties = {
  width: '4.5rem',
  backgroundColor: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '4px',
  color: 'white',
  fontSize: '0.8rem',
  letterSpacing: '0.1em',
  textAlign: 'center',
  padding: '4px 6px',
  fontFamily: 'monospace',
  outline: 'none',
};

const SETTING_SELECT_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '4px',
  color: 'white',
  fontSize: '0.75rem',
  padding: '3px 6px',
  fontFamily: 'monospace',
  outline: 'none',
};

// Narrower than PANEL_STYLE and fixed-width rather than maxWidth — it sits
// beside the main panel (see the outer row below), not in place of it. Same
// width as ControlsSettings' own panel so the two side columns read as a
// matched pair flanking the main one.
const QUICK_CHAT_PANEL_STYLE: React.CSSProperties = {
  width: '210px',
  flexShrink: 0,
  backgroundColor: 'rgba(5,5,8,0.72)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '0.85rem',
  boxShadow: '0 10px 35px rgba(0,0,0,0.45)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const QUICK_CHAT_BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  color: 'rgba(255,255,255,0.85)',
  padding: '6px 8px',
  fontSize: '0.65rem',
  cursor: 'pointer',
  borderRadius: '4px',
  textAlign: 'left',
  fontFamily: 'monospace',
  lineHeight: 1.3,
};

export default function OnlineLobby({
  onStart, onCancel, initialCode,
  roomCode, isHost, opponents, selfReady, readyGuestIds, startAt,
  createRoom, joinRoom, sendReady, leaveRoom,
  quickplayStatus, onQuickplaySearch, onQuickplayCancel,
  winCount,
  nickname, setNickname, hostGuestId, roomSettings, setMaxPlayers, setStartingLevel, setLives, sendKick, wasKicked,
  quickChatLog, sendQuickChat,
}: OnlineLobbyProps) {
  const [entryMode, setEntryMode] = useState<'choose' | 'joining'>('choose');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [countdownMs, setCountdownMs] = useState<number | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const startedRef = useRef(false);
  const autoJoinedRef = useRef(false);
  const chatLogEndRef = useRef<HTMLDivElement>(null);

  // Keeps the newest message in view without the whole page scrolling —
  // 'nearest' so it's a no-op while the log already fits (i.e. hasn't
  // started scrolling yet).
  useEffect(() => {
    chatLogEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [quickChatLog]);

  useEffect(() => {
    if (initialCode && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      joinRoom(initialCode);
    }
  }, [initialCode, joinRoom]);

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

  // A kick can land while entryMode is still 'joining' (e.g. the removed
  // player had the room-code screen open at the time) — without this, the
  // wasKicked notice below would be unreachable, since 'joining' is a
  // different branch than the one it's shown in.
  useEffect(() => {
    if (wasKicked) setEntryMode('choose');
  }, [wasKicked]);

  return (
    // width:100% + alignItems:'stretch' matter here, not just centering:
    // VersusApp's own wrapper is a flex row with alignItems:'center'
    // (shrink-to-fit), so without an explicit width this container has no
    // real width for its own children to lay out against; alignItems on
    // *this* container being 'center' (rather than the default 'stretch')
    // compounds it one level down, shrink-wrapping the row itself too. Net
    // effect without both fixes: the row's flexWrap has nothing to measure
    // "available space" against and wraps every child onto its own line
    // immediately regardless of viewport width (confirmed live: the row
    // rendered at ~422px wide, narrower than even one side panel plus the
    // main panel, wrapping Controls below everything instead of beside it).
    // The title/paragraph below still read as centered even though this
    // container no longer shrink-wraps them, since they center themselves
    // via their own textAlign, not via being sized to their content here.
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '1.5rem', color: 'white', fontFamily: 'monospace' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', color: 'var(--tt-accent)', textShadow: '0 2px 6px rgba(0,0,0,0.85), 0 0 20px color-mix(in srgb, var(--tt-accent) 80%, transparent)', margin: '0 0 0.4rem 0', letterSpacing: '0.15em' }}>
          1V1 ONLINE
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.2em', fontSize: '0.75rem', margin: 0 }}>
          BETA — LAST PLAYER STANDING WINS
        </p>
      </div>

      {/* Three columns, all stretched to match whichever is tallest (see
          alignItems below) — chat and controls are both room-independent
          asides flanking the actual lobby panel in the middle, not part of
          the same "container" it is, hence being pulled out to siblings of
          it rather than nested inside. Quick chat only appears once
          actually in a room (see roomCode below), but Controls is a purely
          local preference with no room dependency, so it's always shown —
          including on the pre-room choose screen, which used to be a lone
          narrow panel in a lot of otherwise-empty space. */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
      {/* Quick chat — only once actually in a room (see roomCode below);
          sits to the left of the main panel rather than inside it, so it
          doesn't push the room-code/settings/ready UI around as messages
          come in. */}
      {roomCode && (
        <div style={QUICK_CHAT_PANEL_STYLE}>
          <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0, textAlign: 'center' }}>
            Quick Chat
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1, minHeight: '3.5rem', overflowY: 'auto' }}>
            {quickChatLog.length === 0 ? (
              <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)' }}>No messages yet</span>
            ) : (
              quickChatLog.map((entry) => (
                <p key={entry.id} style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.8)', margin: 0, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  <span style={{ color: 'var(--tt-accent)', fontWeight: 'bold' }}>
                    {entry.nickname || entry.guestId.slice(0, 4).toUpperCase()}:
                  </span>{' '}
                  {QUICK_CHAT_MESSAGES[entry.messageId]}
                </p>
              ))
            )}
            <div ref={chatLogEndRef} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.6rem' }}>
            {QUICK_CHAT_MESSAGES.map((msg, i) => (
              <button key={i} onClick={() => sendQuickChat(i)} style={QUICK_CHAT_BUTTON_STYLE}>
                {msg}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={PANEL_STYLE}>
        {/* Always visible regardless of which sub-screen below is showing —
            it's an identity setting, not a room-specific one, and it's
            broadcast live via presence so changing it mid-lobby still
            reaches everyone else (see useOnlineRoom). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Nickname</span>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={4}
            placeholder="YOU"
            style={NICKNAME_INPUT_STYLE}
          />
        </div>

        {/* initialCode (from a shared join link) stays truthy for this
            component's whole lifetime — VersusApp only blanks it out while
            actually in a room (roomCode truthy), so getting kicked drops
            roomCode back to null and this condition would otherwise become
            true again forever, stranding a link-joiner on "Joining room…"
            with no buttons ever reachable (the choose screen below was
            gated on !initialCode, which never becomes true for them). The
            !wasKicked guard here, paired with the (!initialCode ||
            wasKicked) guard below, is what actually gets them back to a
            screen with buttons on it. */}
        {!roomCode && initialCode && !wasKicked && (
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', margin: 0 }}>
            Joining room {initialCode}…
          </p>
        )}

        {!roomCode && (!initialCode || wasKicked) && entryMode === 'choose' && quickplayStatus === 'idle' && (
          <>
            {wasKicked && (
              <p style={{ textAlign: 'center', color: '#f87171', fontSize: '0.75rem', margin: 0 }}>
                You were removed from the room by the host.
              </p>
            )}
            <button style={PRIMARY_BUTTON_STYLE} onClick={onQuickplaySearch}>Quick Play</button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={() => createRoom()}>Create Room</button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={() => setEntryMode('joining')}>Join Room</button>
            <button style={SECONDARY_BUTTON_STYLE} onClick={onCancel}>Back</button>
          </>
        )}

        {!roomCode && (!initialCode || wasKicked) && quickplayStatus === 'searching' && (
          <>
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', margin: 0 }}>
              Searching for an opponent…
            </p>
            <button style={SECONDARY_BUTTON_STYLE} onClick={onQuickplayCancel}>Cancel</button>
          </>
        )}

        {!roomCode && (!initialCode || wasKicked) && entryMode === 'joining' && (
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
              <p style={{ fontSize: '1.8rem', fontWeight: 'bold', letterSpacing: '0.3em', color: 'var(--tt-accent)', textShadow: '0 0 12px color-mix(in srgb, var(--tt-accent) 60%, transparent)', margin: 0 }}>
                {roomCode}
              </p>
              {isHost && (
                <>
                  <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginTop: '0.5rem' }}>
                    Share this code with your opponent, or send them a link:
                  </p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/versus?code=${roomCode}`);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1500);
                    }}
                    style={{
                      marginTop: '0.4rem', backgroundColor: 'transparent', border: '1px solid rgba(126,231,135,0.4)',
                      color: '#7ee787', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer',
                      fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                    }}
                  >
                    {linkCopied ? 'Copied!' : 'Copy Join Link'}
                  </button>
                </>
              )}
            </div>

            <p style={{ textAlign: 'center', fontSize: '0.8rem', color: opponents.length > 0 ? '#7ee787' : 'rgba(255,255,255,0.6)', margin: 0 }}>
              {opponents.length > 0
                ? `${opponents.length + 1} / ${roomSettings.maxPlayers} connected`
                : 'Waiting for opponents…'}
            </p>

            {/* Room size is informational here, not a hard join gate (see
                useOnlineRoom) — kicking is the actual way to stay under it.
                Starting level is real, though: it's what TetrisGame actually
                starts the match at. Host edits both; everyone else just sees
                the current values, since they're broadcast live via the
                host's own presence. */}
            {!startAt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Room Size</span>
                  {isHost ? (
                    <select value={roomSettings.maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} style={SETTING_SELECT_STYLE}>
                      {Array.from({ length: MAX_ROOM_SIZE - 1 }, (_, i) => i + 2).map((n) => (
                        <option key={n} value={n}>{n} players</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: 'white' }}>{roomSettings.maxPlayers} players</span>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Starting Level</span>
                  {isHost ? (
                    <select value={roomSettings.startingLevel} onChange={(e) => setStartingLevel(Number(e.target.value))} style={SETTING_SELECT_STYLE}>
                      {Array.from({ length: MAX_STARTING_LEVEL }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: 'white' }}>{roomSettings.startingLevel}</span>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Lives</span>
                  {isHost ? (
                    <select value={roomSettings.lives} onChange={(e) => setLives(Number(e.target.value))} style={SETTING_SELECT_STYLE}>
                      {Array.from({ length: MAX_LIVES }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: 'white' }}>{roomSettings.lives}</span>
                  )}
                </div>
              </div>
            )}

            {opponents.length > 0 && !startAt && (
              <>
                <button
                  style={{ ...PRIMARY_BUTTON_STYLE, opacity: selfReady ? 0.6 : 1 }}
                  disabled={selfReady}
                  onClick={sendReady}
                >
                  {selfReady ? 'Waiting for others…' : 'Ready'}
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{nickname || 'You'}{isHost ? ' (Host)' : ''}</span>
                    <span>{selfReady ? 'Ready' : 'Not ready'}</span>
                  </div>
                  {opponents.map((o) => (
                    <div key={o.guestId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{o.nickname || o.guestId.slice(0, 4).toUpperCase()}{o.guestId === hostGuestId ? ' (Host)' : ''}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {readyGuestIds.has(o.guestId) ? 'Ready' : 'Not ready'}
                        {isHost && (
                          <button
                            onClick={() => sendKick(o.guestId)}
                            aria-label={`Remove ${o.nickname || 'player'}`}
                            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.8rem', padding: 0, lineHeight: 1 }}
                            onMouseOver={(e) => { e.currentTarget.style.color = '#f87171'; }}
                            onMouseOut={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {startAt && countdownMs !== null && (
              <h3 style={{ textAlign: 'center', color: 'white', letterSpacing: '0.1em', margin: 0, textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>
                Starting in {(countdownMs / 1000).toFixed(1)}s
              </h3>
            )}

            {winCount > 0 && (
              <p style={{ textAlign: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
                Wins this session: {winCount}
              </p>
            )}

            <button style={SECONDARY_BUTTON_STYLE} onClick={handleLeave}>Leave Room</button>
          </>
        )}
      </div>

      <ControlsSettings />
      </div>
    </div>
  );
}
