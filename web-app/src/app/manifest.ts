import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RabbitTech Logistics',
    short_name: 'RabbitTech',
    description: 'Real-time freight marketplace and shipment control tower.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#081121',
    theme_color: '#081121',
    categories: ['business', 'logistics', 'productivity'],
    icons: [
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}