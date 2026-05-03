'use client';

import { useEffect, useRef } from 'react';
import type { DivIcon, LayerGroup, Map as LeafletMap } from 'leaflet';
import type { Coordinate, RoutePlan } from '../lib/tracking';
import type { TruckSignalState } from '../lib/types';

export interface TrackingMapTrip {
  loadId: string;
  referenceNumber: string;
  pickup: Coordinate;
  dropoff: Coordinate;
  position: (Coordinate & { heading_deg?: number | null }) | null;
  signalStatus: TruckSignalState;
}

interface TrackingMapProps {
  shipments: TrackingMapTrip[];
  selectedLoadId: string | null;
  onSelectLoadId: (loadId: string) => void;
  route: RoutePlan | null;
}

const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? '&copy; OpenStreetMap contributors';

function getMarkerTone(signalStatus: TruckSignalState) {
  if (signalStatus === 'ONLINE' || signalStatus === 'RECONNECTED') return 'online';
  if (signalStatus === 'DEGRADED_SIGNAL' || signalStatus === 'RECONNECTING') return 'warning';
  return 'offline';
}

export function TrackingMap({ shipments, selectedLoadId, onSelectLoadId, route }: TrackingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let disposed = false;

    async function renderMap() {
      if (!containerRef.current) {
        return;
      }

      const L = await import('leaflet');
      if (disposed || !containerRef.current) {
        return;
      }

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          zoomControl: false,
          scrollWheelZoom: true,
        }).setView([39.5, -98.35], 4);

        L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
        L.tileLayer(TILE_URL, {
          maxZoom: 18,
          attribution: TILE_ATTRIBUTION,
        }).addTo(mapRef.current);

        layersRef.current = L.layerGroup().addTo(mapRef.current);
      }

      const map = mapRef.current;
      const layers = layersRef.current;
      if (!map || !layers) {
        return;
      }

      layers.clearLayers();

      const selectedTrip = shipments.find((shipment) => shipment.loadId === selectedLoadId) ?? shipments[0] ?? null;
      const bounds: Array<[number, number]> = [];

      const createWaypointIcon = (kind: 'pickup' | 'dropoff') => L.divIcon({
        className: '',
        iconSize: [16, 16],
        html: `<div class="tracking-map-waypoint tracking-map-waypoint--${kind}"></div>`,
      });

      const createTruckIcon = (signalStatus: TruckSignalState, isSelected: boolean, heading?: number | null): DivIcon => L.divIcon({
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        html: `<div class="tracking-map-marker tracking-map-marker--${getMarkerTone(signalStatus)}" style="transform: rotate(${heading ?? 0}deg) scale(${isSelected ? 1.15 : 1});"></div>`,
      });

      for (const shipment of shipments) {
        const isSelected = shipment.loadId === selectedTrip?.loadId;

        L.marker([shipment.pickup.lat, shipment.pickup.lng], { icon: createWaypointIcon('pickup') })
          .addTo(layers)
          .bindPopup(`${shipment.referenceNumber}<br/>Pickup`);

        L.marker([shipment.dropoff.lat, shipment.dropoff.lng], { icon: createWaypointIcon('dropoff') })
          .addTo(layers)
          .bindPopup(`${shipment.referenceNumber}<br/>Dropoff`);

        if (isSelected) {
          L.circle([shipment.pickup.lat, shipment.pickup.lng], {
            radius: 563.27,
            color: '#34d399',
            weight: 1,
            fillColor: '#10b981',
            fillOpacity: 0.08,
          }).addTo(layers);

          L.circle([shipment.dropoff.lat, shipment.dropoff.lng], {
            radius: 563.27,
            color: '#fb7185',
            weight: 1,
            fillColor: '#ef4444',
            fillOpacity: 0.08,
          }).addTo(layers);
        }

        bounds.push([shipment.pickup.lat, shipment.pickup.lng], [shipment.dropoff.lat, shipment.dropoff.lng]);

        if (!shipment.position) {
          continue;
        }

        bounds.push([shipment.position.lat, shipment.position.lng]);

        L.marker([shipment.position.lat, shipment.position.lng], {
          icon: createTruckIcon(shipment.signalStatus, isSelected, shipment.position.heading_deg),
        })
          .addTo(layers)
          .bindPopup(`${shipment.referenceNumber}<br/>Driver location`)
          .on('click', () => onSelectLoadId(shipment.loadId));
      }

      if (selectedTrip && route?.geometry.length) {
        const routeLatLngs = route.geometry.map((point) => [point.lat, point.lng] as [number, number]);
        routeLatLngs.forEach((point) => bounds.push(point));

        L.polyline(routeLatLngs, {
          color: '#38bdf8',
          weight: 4,
          opacity: 0.8,
          dashArray: '14 10',
        }).addTo(layers);
      }

      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: selectedTrip ? 11 : 6 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 10);
      }

      map.invalidateSize();
    }

    renderMap();

    return () => {
      disposed = true;
    };
  }, [onSelectLoadId, route, selectedLoadId, shipments]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="h-[28rem] w-full bg-slate-950" />;
}