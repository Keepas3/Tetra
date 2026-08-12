// Single source of truth for the site's game-mode catalog — shared between
// HomePage.tsx (the mode-select grid) and NavBar.tsx (the Play flyout's
// categorized list), so the two don't drift out of sync with each other as
// modes get added/renamed. Everything here mirrors the categories
// established on the landing page: Arena stands alone (the one headline,
// zero-friction entry point), VERSUS is competitive (Ranked/Versus, plus
// the not-yet-built Build Battle/Journey to the East), 2V2 is the
// team-vs-team co-op pairing, and CASUAL is everything with no opponent at
// all (true solo, plus the two co-op-with-a-partner-but-no-enemy modes).

export interface GameModeInfo {
  id: string;
  label: string;
  href: string;
  blurb: string;
  soon?: boolean;
}

export const ARENA_MODE: GameModeInfo = {
  id: 'arena', label: 'Arena', href: '/arena',
  blurb: 'Public battle royale — up to 100 players, no lobby needed.',
};

// All room modes below route to the same /versus lobby — this project has
// no separate deep-linked URL per game mode, the room's own Game Mode
// selector is the one place that actually picks between them.
export const RANKED_MODE: GameModeInfo = {
  id: 'ranked', href: '/versus', label: 'Ranked Play',
  blurb: 'A rating ladder, matched against similarly-skilled players.', soon: true,
};
export const VERSUS_MODE: GameModeInfo = {
  id: 'versus', href: '/versus', label: 'Versus',
  blurb: 'Last player standing — 1v1 up to an 8-player free-for-all.',
};
// Named but not built yet — neither has real rules worked out (Build
// Battle: race to build a target shape; Journey to the East: a themed
// challenge campaign) before there's any game logic to wire up.
export const BUILD_BATTLE_MODE: GameModeInfo = {
  id: 'build-battle', href: '/versus', label: 'Build Battle',
  blurb: 'Race to build a target shape before your opponent does.', soon: true,
};
export const JOURNEY_MODE: GameModeInfo = {
  id: 'journey', href: '/versus', label: 'Journey to the East',
  blurb: 'A challenge campaign — advance your character toward a set destination.', soon: true,
};

export const TWO_V_TWO_MODES: GameModeInfo[] = [
  { id: 'teams', href: '/versus', label: '2v2 Teams', blurb: 'Separate boards — garbage only ever hits the enemy team.' },
  { id: 'teams-coop', href: '/versus', label: '2v2 Teams Co-op', blurb: 'One shared board per team, still fighting the other team.' },
];

export const CASUAL_MODES: GameModeInfo[] = [
  { id: 'zen', href: '/play?mode=standard', label: 'Zen Mode', blurb: 'No goals, no clock — just stack.' },
  { id: 'sprint', href: '/play?mode=sprint', label: '40 Lines', blurb: 'Clear 40 lines as fast as you can.' },
  { id: 'blitz', href: '/play?mode=blitz', label: 'Blitz', blurb: 'Highest score in 3 minutes.' },
  { id: 'coop-shared', href: '/versus', label: 'Co-op (Shared Board)', blurb: 'Two players, one board, no opponent at all.' },
  { id: 'coop-own', href: '/versus', label: 'Co-op (Own Boards)', blurb: 'Play alongside a partner — no attacks, no win condition.' },
];

export const VERSUS_TOP_ROW: GameModeInfo[] = [RANKED_MODE, VERSUS_MODE, BUILD_BATTLE_MODE, JOURNEY_MODE];
export const ALL_VERSUS_MODES: GameModeInfo[] = [...VERSUS_TOP_ROW, ...TWO_V_TWO_MODES];
