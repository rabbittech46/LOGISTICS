// ─────────────────────────────────────────────────────────────────────────────
// WebSocket client — Socket.IO connection to tracking backend
// Handles: reconnect with fresh auth, stale token refresh, disconnect cleanup
// ─────────────────────────────────────────────────────────────────────────────
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api-client';
import type { TruckPosition, TruckSignalStatus } from './types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'https://localhost';

let socket: Socket | null = null;
let connectionFailedCallbacks: Array<() => void> = [];

function createSocket(): Socket {
  const s = io(WS_URL, {
    path: '/ws/',
    transports: ['websocket', 'polling'],
    auth: { token: getAccessToken() },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  s.on('connect', () => {
    console.log('[WS] Connected:', s.id);
  });

  s.io.on('reconnect_attempt', () => {
    const freshToken = getAccessToken();
    if (freshToken) {
      s.auth = { token: freshToken };
    }
  });

  s.on('connect_error', (err) => {
    console.warn('[WS] Connection error:', err.message);
  });

  s.on('disconnect', (reason) => {
    console.warn('[WS] Disconnected:', reason);
    if (reason === 'io server disconnect') {
      s.connect();
    }
  });

  s.io.on('reconnect_failed', () => {
    console.error('[WS] All reconnection attempts failed');
    connectionFailedCallbacks.forEach((cb) => cb());
  });

  return s;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket();
    return socket;
  }

  const freshToken = getAccessToken();
  if (freshToken) {
    socket.auth = { token: freshToken };
  }

  if (!socket.connected && !socket.active) {
    socket.connect();
  }

  return socket;
}

export function onConnectionFailed(callback: () => void): () => void {
  connectionFailedCallbacks.push(callback);
  return () => {
    connectionFailedCallbacks = connectionFailedCallbacks.filter((cb) => cb !== callback);
  };
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

// ── Subscription helpers ────────────────────────────────────────────────────
export function subscribeTruck(truckId: string) {
  getSocket().emit('subscribe:truck', truckId);
}

export function unsubscribeTruck(truckId: string) {
  getSocket().emit('unsubscribe:truck', truckId);
}

export function subscribeLoad(loadId: string) {
  getSocket().emit('subscribe:load', loadId);
}

export function unsubscribeLoad(loadId: string) {
  getSocket().emit('unsubscribe:load', loadId);
}

export function subscribeAssignment(assignmentId: string) {
  getSocket().emit('subscribe:assignment', assignmentId);
}

export function unsubscribeAssignment(assignmentId: string) {
  getSocket().emit('unsubscribe:assignment', assignmentId);
}

// ── Event listeners ─────────────────────────────────────────────────────────
export function onTruckPosition(
  callback: (pos: TruckPosition) => void,
): () => void {
  const s = getSocket();
  s.on('truck:position', callback);
  s.on('fleet:position', callback);
  return () => {
    s.off('truck:position', callback);
    s.off('fleet:position', callback);
  };
}

export function onTruckSignalStatus(
  callback: (status: TruckSignalStatus) => void,
): () => void {
  const s = getSocket();
  s.on('truck:signal_status', callback);
  return () => {
    s.off('truck:signal_status', callback);
  };
}
