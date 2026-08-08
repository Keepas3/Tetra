'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  THEME_PRESETS,
  DEFAULT_THEME_PRESET_ID,
  CUSTOM_THEME_ID,
  DEFAULT_CUSTOM_ACCENT,
  buildCustomTokens,
  type ThemeTokens,
} from './themePresets';

const STORAGE_KEY_PRESET = 'tetris-arena:theme-preset';
const STORAGE_KEY_CUSTOM_ACCENT = 'tetris-arena:theme-custom-accent';

function tokensFor(presetId: string, customAccent: string): ThemeTokens {
  if (presetId === CUSTOM_THEME_ID) return buildCustomTokens(customAccent);
  return (THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0]).tokens;
}

function applyTokens(tokens: ThemeTokens) {
  const root = document.documentElement.style;
  root.setProperty('--tt-bg', tokens.bg);
  root.setProperty('--tt-bg-elevated', tokens.bgElevated);
  root.setProperty('--tt-accent', tokens.accent);
  root.setProperty('--tt-accent-secondary', tokens.accentSecondary);
  root.setProperty('--tt-text', tokens.text);
}

// Same hydration-safe shape as useSearchParam/isMobile elsewhere in this
// codebase: state starts at the value already baked into globals.css's
// :root defaults (Ice Cyan) so server and first client paint match, then a
// mount-only effect reads localStorage and applies the user's saved choice.
export function useColorTheme() {
  const [presetId, setPresetIdState] = useState(DEFAULT_THEME_PRESET_ID);
  const [customAccent, setCustomAccentState] = useState(DEFAULT_CUSTOM_ACCENT);

  useEffect(() => {
    const savedPreset = localStorage.getItem(STORAGE_KEY_PRESET);
    const savedCustomAccent = localStorage.getItem(STORAGE_KEY_CUSTOM_ACCENT);
    const nextPreset = savedPreset ?? DEFAULT_THEME_PRESET_ID;
    const nextCustomAccent = savedCustomAccent ?? DEFAULT_CUSTOM_ACCENT;
    setPresetIdState(nextPreset);
    setCustomAccentState(nextCustomAccent);
    applyTokens(tokensFor(nextPreset, nextCustomAccent));
  }, []);

  const setPresetId = useCallback((id: string) => {
    setPresetIdState(id);
    localStorage.setItem(STORAGE_KEY_PRESET, id);
    applyTokens(tokensFor(id, customAccent));
  }, [customAccent]);

  const setCustomAccent = useCallback((hex: string) => {
    setCustomAccentState(hex);
    setPresetIdState(CUSTOM_THEME_ID);
    localStorage.setItem(STORAGE_KEY_CUSTOM_ACCENT, hex);
    localStorage.setItem(STORAGE_KEY_PRESET, CUSTOM_THEME_ID);
    applyTokens(tokensFor(CUSTOM_THEME_ID, hex));
  }, []);

  return {
    presetId,
    customAccent,
    presets: THEME_PRESETS,
    setPresetId,
    setCustomAccent,
  };
}
