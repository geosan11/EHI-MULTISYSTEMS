import { QRCodeSVG } from 'qrcode.react';

export const QRCode = ({ id, size = 150 }: { id: string; size?: number }) => {
  return (
    <QRCodeSVG 
      value={id} 
      size={size}
      level="M"
      includeMargin={true}
      bgColor="#FFFFFF"
      fgColor="#000000"
    />
  );
};

