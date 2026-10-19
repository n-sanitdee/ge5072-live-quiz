import qrcode from 'qrcode-generator';
import {useMemo} from 'react';

/** Crisp QR code drawn as one SVG path. */
export function Qr({text, className}: {text: string; className?: string}) {
  const {d, n} = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return {d, n};
  }, [text]);
  return (
    <svg className={className} viewBox={`0 0 ${n + 4} ${n + 4}`} role="img" aria-label="QR code to join">
      <rect width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#000" shapeRendering="crispEdges" />
    </svg>
  );
}
