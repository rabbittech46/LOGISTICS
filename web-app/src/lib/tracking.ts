import type { GeoPoint } from './types';

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RoutePlan {
  distanceMiles: number;
  durationSeconds: number;
  geometry: Coordinate[];
}

const EARTH_RADIUS_MILES = 3958.7613;
const OSRM_BASE_URL = process.env.NEXT_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';

export function geoPointToLatLng(point: GeoPoint): Coordinate {
  return {
    lng: point.coordinates[0],
    lat: point.coordinates[1],
  };
}

export function haversineMiles(origin: Coordinate, destination: Coordinate): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(destination.lat - origin.lat);
  const dLng = toRadians(destination.lng - origin.lng);
  const startLat = toRadians(origin.lat);
  const endLat = toRadians(destination.lat);

  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

export function isWithinRadiusMiles(distanceMiles: number, thresholdMiles: number) {
  return distanceMiles <= thresholdMiles;
}

export async function fetchOsrmRoute(points: Coordinate[]): Promise<RoutePlan | null> {
  if (points.length < 2) {
    return null;
  }

  const encodedCoordinates = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(';');

  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'false',
  });

  try {
    const response = await fetch(`${OSRM_BASE_URL}/route/v1/driving/${encodedCoordinates}?${params.toString()}`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const route = payload.routes?.[0];
    if (!route?.geometry?.coordinates?.length) {
      return null;
    }

    return {
      distanceMiles: route.distance / 1609.344,
      durationSeconds: route.duration,
      geometry: route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng })),
    };
  } catch {
    return null;
  }
}