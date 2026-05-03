declare module 'firebase-admin' {
  interface Credential {
    getAccessToken(): Promise<{ access_token: string; expires_in: number }>;
  }
  function cert(path: string): Credential;
  function applicationDefault(): Credential;
  const credential: { cert: typeof cert; applicationDefault: typeof applicationDefault };
  function initializeApp(config: {
    credential?: Credential;
    projectId?: string;
  }): any;
  export { credential, initializeApp };
  export default { credential, initializeApp };
}

declare module 'firebase-admin/messaging' {
  export interface MulticastMessage {
    tokens: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }
  export interface Messaging {
    sendEachForMulticast(message: MulticastMessage): Promise<any>;
  }
  export function getMessaging(app?: any): Messaging;
}
