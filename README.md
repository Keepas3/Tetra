# tetris-arena

Standalone sandbox spun off from the Tetris game in [saiushi](../saiushi). Phase 1 of the online-play experiment: get the existing Sandbox/Sprint/Blitz modes running on their own site before adding any multiplayer code.

## Setup

1. `npm install`
2. Create a Supabase project, then add a `tetris_scores` table:
   - `name` text
   - `score` int8
   - `level` int8
   - `mode` text
   - `created_at` timestamptz, default `now()`
   - RLS: allow public `select` and `insert` (no auth in this sandbox)
3. Copy `.env.local.example` to `.env.local` and fill in the Supabase URL/anon key.
4. `npm run dev`

## What's different from saiushi

- No Sanity CMS — `UseBackgroundTheme.ts` is a local stub with a single "Classic" theme instead of the CMS-driven picker.
- No modal wrapper — the game renders full-page directly (`app/page.tsx`), so `TetrisModal.tsx` / `framer-motion` weren't carried over.
- No blog, fortune slip, audio player, or any other saiushi content — just the Tetris pieces.

`TetrisGame.tsx`, `TitleScreen.tsx`, `TetrisApp.tsx`, and `tetrisConstants.ts` are otherwise unmodified copies, so gameplay fixes should stay portable between the two projects for now.
