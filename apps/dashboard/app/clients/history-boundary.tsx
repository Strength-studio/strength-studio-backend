'use client';

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function ClientHistoryBoundary({ children }: { children: ReactNode }) {
  const workspace = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    // A back-forward cache snapshot must stay concealed until the server checks the current session.
    const hide = (event: PageTransitionEvent) => {
      if (event.persisted) element.style.visibility = 'hidden';
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
    };
  }, []);

  return <div ref={workspace} className="workspace">{children}</div>;
}
