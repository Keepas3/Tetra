// Accent theming: a small set of curated presets plus a "custom" slot where
// the user picks their own accent and we derive a complementary secondary
// color from it (hue-rotated), so "adjust to your liking" doesn't require a
// multi-field color form. Tokens are applied as CSS custom properties
// (see useColorTheme.ts) rather than baked into component styles, which is
// what actually makes the theme swappable instead of just reskinned once.

export interface ThemeTokens {
  bg: string;
  bgElevated: string;
  accent: string;
  accentSecondary: string;
  text: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  tokens: ThemeTokens;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ice-cyan',
    label: 'Ice Cyan',
    tokens: {
      bg: '#05090f',
      bgElevated: '#0a121b',
      accent: '#4fd1ff',
      accentSecondary: '#ff2e63',
      text: '#e6f6fb',
    },
  },
  {
    id: 'cyber-violet',
    label: 'Cyber Violet',
    tokens: {
      bg: '#0a0710',
      bgElevated: '#140e1e',
      accent: '#b026ff',
      accentSecondary: '#7dd3fc',
      text: '#eae4f5',
    },
  },
  {
    id: 'arcade-amber',
    label: 'Arcade Amber',
    tokens: {
      bg: '#0c0a06',
      bgElevated: '#16110a',
      accent: '#ffb020',
      accentSecondary: '#ff4d4d',
      text: '#f5ece0',
    },
  },
  {
    id: 'terminal-green',
    label: 'Terminal Green',
    tokens: {
      bg: '#06100a',
      bgElevated: '#0a140e',
      accent: '#39ff88',
      accentSecondary: '#00d4ff',
      text: '#e3f5ea',
    },
  },
];

export const DEFAULT_THEME_PRESET_ID = 'ice-cyan';
export const CUSTOM_THEME_ID = 'custom';

// Neutral ground for the custom slot — not tinted toward any particular
// accent, since the whole point is the accent can be anything.
const CUSTOM_BASE = {
  bg: '#07080a',
  bgElevated: '#101216',
  text: '#f0f1f3',
};

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Secondary = accent rotated a third of the way around the wheel, brightened
// slightly so it still pops against a near-black ground.
export function buildCustomTokens(accentHex: string): ThemeTokens {
  const [h, s, l] = hexToHsl(accentHex);
  const secondary = hslToHex((h + 130) % 360, Math.max(s, 0.6), Math.min(Math.max(l, 0.55), 0.7));
  return {
    ...CUSTOM_BASE,
    accent: accentHex,
    accentSecondary: secondary,
  };
}

export const DEFAULT_CUSTOM_ACCENT = '#4fd1ff';
