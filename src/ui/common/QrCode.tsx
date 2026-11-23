import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** 文字列を QR コード（SVG）にする */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
      }
    }
    return { size: n + 4, path: d };
  }, [text]);

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QRコード" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
