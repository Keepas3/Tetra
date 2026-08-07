'use client';

import React, { useState } from 'react';
import TitleScreen from './TitleScreen';
import TetrisGame from './TetrisGame';
import OnlineLobby from './OnlineLobby';

export default function TetrisApp() {
  const [view, setView] = useState<'TITLE' | 'LOBBY' | 'PLAYING'>('TITLE');
  const [gameMode, setGameMode] = useState('standard');

  const handlePlay = (mode: string) => {
    // The title screen's "Versus" button routes here instead of straight to
    // PLAYING — it needs a room + synchronized start before there's a match
    // to play.
    if (mode === 'versus-lobby') {
      setView('LOBBY');
      return;
    }
    setGameMode(mode);
    setView('PLAYING');
  };

  const handleMenu = () => {
    setView('TITLE');
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {view === 'TITLE' && <TitleScreen onPlay={handlePlay} />}

      {view === 'LOBBY' && (
        <OnlineLobby
          onStart={() => { setGameMode('versus'); setView('PLAYING'); }}
          onCancel={handleMenu}
        />
      )}

      {/* We pass the gameMode down, and give it a way to return to the menu! */}
      {view === 'PLAYING' && <TetrisGame mode={gameMode} onMenu={handleMenu} />}
    </div>
  );
}
