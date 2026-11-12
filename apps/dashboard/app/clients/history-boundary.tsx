'use client';

import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';

export function ClientHistoryBoundary({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    // Next.js can retain Client route data after the workspace unmounts.
    document.documentElement.setAttribute('data-client-history', '');
  }, []);

  return <div data-client-workspace="" className="workspace">{children}</div>;
}
