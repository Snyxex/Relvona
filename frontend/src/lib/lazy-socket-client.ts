type Listener = (...args: any[]) => void;
type SocketLike = {
  on(event: string, listener: Listener): SocketLike;
  emit(event: string, ...args: any[]): SocketLike;
  disconnect(): SocketLike;
};

type RealSocket = {
  on(event: string, listener: Listener): RealSocket;
  emit(event: string, ...args: any[]): RealSocket;
  disconnect(): RealSocket;
};

/**
 * Minimal lazy Socket.IO facade used by the legacy dashboard.
 * The heavy socket.io-client package is fetched only when io() is actually
 * called, which currently happens only after a conversation is selected.
 */
export function io(uri?: string, options?: Record<string, unknown>): SocketLike {
  let realSocket: RealSocket | null = null;
  let disposed = false;
  const listeners: Array<[string, Listener]> = [];
  const pendingEmits: Array<[string, any[]]> = [];

  const facade: SocketLike = {
    on(event, listener) {
      if (realSocket) realSocket.on(event, listener);
      else listeners.push([event, listener]);
      return facade;
    },
    emit(event, ...args) {
      if (realSocket) realSocket.emit(event, ...args);
      else pendingEmits.push([event, args]);
      return facade;
    },
    disconnect() {
      disposed = true;
      pendingEmits.length = 0;
      listeners.length = 0;
      realSocket?.disconnect();
      realSocket = null;
      return facade;
    },
  };

  void import("socket.io-client-real")
    .then(({ io: createSocket }) => {
      if (disposed) return;
      const socket = createSocket(uri, options) as RealSocket;
      realSocket = socket;
      for (const [event, listener] of listeners.splice(0)) socket.on(event, listener);
      for (const [event, args] of pendingEmits.splice(0)) socket.emit(event, ...args);
    })
    .catch((error) => {
      if (disposed) return;
      const connectErrorListeners = listeners.filter(([event]) => event === "connect_error");
      for (const [, listener] of connectErrorListeners) listener(error);
    });

  return facade;
}
