import {type ReactNode, useEffect, useState} from 'react';

export const APP_NAME = 'GE5072 Live Quiz';

/** The four answer shapes, in answer order: triangle, diamond, circle, square. */
export function Shape({k, size = 40}: {k: number; size?: number}) {
  const common = {width: size, height: size, viewBox: '0 0 40 40', 'aria-hidden': true} as const;
  if (k === 0) return <svg {...common}><path d="M20 4 37 34H3Z" fill="#fff" /></svg>;
  if (k === 1) return <svg {...common}><path d="M20 2 38 20 20 38 2 20Z" fill="#fff" /></svg>;
  if (k === 2) return <svg {...common}><circle cx="20" cy="20" r="17" fill="#fff" /></svg>;
  return <svg {...common}><rect x="4" y="4" width="32" height="32" rx="2" fill="#fff" /></svg>;
}

/** English line with the Thai translation underneath. */
export function Bi({en, th, className}: {en: ReactNode; th: ReactNode; className?: string}) {
  return (
    <span className={`bi ${className ?? ''}`}>
      <span className="en">{en}</span>
      <span className="th" lang="th">{th}</span>
    </span>
  );
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Re-render every `ms` while `active` (for countdowns). */
export function useTicker(active: boolean, ms = 100) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}
