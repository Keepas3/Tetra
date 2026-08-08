'use client';

import React, { useState } from 'react';
import TitleScreen from './TitleScreen';
import TetrisGame from './TetrisGame';

const VALID_INITIAL_MODES = ['standard', 'sprint', 'blitz'];

interface TetrisAppProps {
  // Set from the nav bar's Play menu (e.g. /?mode=sprint) so a mode can be
  // jumped into directly from anywhere on the site, not just the title
  // screen's own buttons.
  initialMode?: string;
}

export default function TetrisApp({ initialMode }: TetrisAppProps) {
  const validInitialMode = initialMode && VALID_INITIAL_MODES.includes(initialMode) ? initialMode : undefined;

  const [view, setView] = useState<'TITLE' | 'PLAYING'>(validInitialMode ? 'PLAYING' : 'TITLE');
  const [gameMode, setGameMode] = useState(validInitialMode ?? 'standard');

  const handlePlay = (mode: string) => {
    setGameMode(mode);
    setView('PLAYING');
  };

  const handleMenu = () => {
    setView('TITLE');
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {view === 'TITLE' && <TitleScreen onPlay={handlePlay} />}

      {/* We pass the gameMode down, and give it a way to return to the menu! */}
      {view === 'PLAYING' && <TetrisGame mode={gameMode} onMenu={handleMenu} />}
    </div>
  );
}
