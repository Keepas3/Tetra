'use client';

import { useCallback, useState } from 'react';

// Lightweight stand-in for saiushi's Sanity-backed theme picker. This
// sandbox has no CMS, so there's exactly one theme — TitleScreen's theme
// picker UI still works, it just has a single "Classic" option to show.

export interface BackgroundTheme {
  id: string;
  label: string;
  swatchColor: string;
  backgroundImage: string;
  backgroundColor: string;
}

const DEFAULT_THEME: BackgroundTheme = {
  id: 'default',
  label: 'Classic',
  swatchColor: '#1a1a1a',
  backgroundImage: 'none',
  backgroundColor: 'transparent',
};

export const DEFAULT_BACKGROUND_THEME_ID = DEFAULT_THEME.id;

export function useBackgroundTheme() {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_BACKGROUND_THEME_ID);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
  }, []);

  return {
    themeId,
    theme: DEFAULT_THEME,
    themes: [DEFAULT_THEME],
    setThemeId,
    isLoading: false,
  };
}
