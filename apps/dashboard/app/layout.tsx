import type { ReactNode } from 'react';
import { ClientHistoryGuard } from './clients/history-guard';
import './globals.css';

export const metadata = { title: 'Strength Studio' };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><head><ClientHistoryGuard /></head><body>{children}</body></html>;
}
