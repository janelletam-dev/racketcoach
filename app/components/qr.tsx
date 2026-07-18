"use client";

import { QRCodeSVG } from "qrcode.react";

export function Qr({ value, size = 176 }: { value: string; size?: number }) {
  return (
    <div className="inline-block bg-white p-3 rounded-xl border-2 border-rc-line">
      <QRCodeSVG value={value} size={size} level="M" marginSize={0} />
    </div>
  );
}
