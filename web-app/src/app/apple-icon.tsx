import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};

export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 58%, #0f766e 100%)',
          color: '#f8fafc',
          fontSize: 74,
          fontWeight: 700,
          letterSpacing: '-0.08em',
          borderRadius: 40,
        }}
      >
        RT
      </div>
    ),
    size,
  );
}