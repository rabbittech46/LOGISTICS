RabbitTech Logistics is the customer-facing web application for the freight platform. It includes shipper, carrier, driver, and admin workflows, live assignment tracking, and installable PWA support.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open http://localhost:3000.

## Key Environment Variables

The live tracking experience uses open-source services only.

```bash
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=http://localhost:3001
NEXT_PUBLIC_OSRM_URL=https://router.project-osrm.org
NEXT_PUBLIC_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
NEXT_PUBLIC_TILE_ATTRIBUTION=&copy; OpenStreetMap contributors
```

For production, point `NEXT_PUBLIC_OSRM_URL` at your own OSRM or GraphHopper deployment rather than the public demo service.

## Tracking Stack

- Base map: OpenStreetMap tiles
- Rendering: Leaflet
- Routing and ETA: OSRM HTTP API
- Real-time transport: Socket.IO over the tracking service
- Offline/installability: Web manifest plus service worker caching

## Production Notes

- Build with standalone output enabled for Docker deployments.
- Configure HTTPS in front of the app so service workers and install prompts work reliably.
- Use a dedicated tile server or commercial OSM hosting if you expect sustained production traffic.

## Capacitor Android

The mobile app path uses a hosted Capacitor wrapper around the deployed Next.js app. This keeps App Router features intact and avoids trying to statically export runtime-driven routes.

Set a deployed web origin before syncing the native shell:

```bash
CAPACITOR_SERVER_URL=https://app.rabbittech.example
```

Then use the native workflow:

```bash
npm run native:doctor
npm run native:prepare
npm run native:open:android
```

To generate a local debug APK directly from the command line:

```bash
npm run native:apk:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

`native-shell/index.html` is only a packaged fallback shell used for Capacitor asset syncing. Production Android builds should point `CAPACITOR_SERVER_URL` at an HTTPS deployment of the web app.

## Build

```bash
npm run build
```
