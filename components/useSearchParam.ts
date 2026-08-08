'use client';

import { useEffect, useState } from 'react';

// Reads a single URL query param, client-side only, resolved after mount —
// same hydration-safe shape as isMobile in TetrisGame.tsx (identical render
// on the server and the client's first paint, updated via useEffect once
// window is available). Deliberately not next/navigation's useSearchParams:
// on a page that's fully client-rendered anyway (no SEO/content value from
// SSR-ing the param), wrapping it in Suspense just forces that boundary to
// bail out to client-only rendering (visible in the SSR HTML as a
// BAILOUT_TO_CLIENT_SIDE_RENDERING marker) — which triggers a hydration
// mismatch warning in this Next.js version without actually buying anything,
// since the content was only ever going to resolve on the client either way.
export function useSearchParam(key: string): string | undefined {
  const [value, setValue] = useState<string | undefined>(undefined);

  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(key) ?? undefined);
  }, [key]);

  return value;
}
