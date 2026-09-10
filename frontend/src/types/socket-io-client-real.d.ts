declare module "socket.io-client-real" {
  export type Socket = {
    on(event: string, listener: (...args: any[]) => void): Socket;
    emit(event: string, ...args: any[]): Socket;
    disconnect(): Socket;
  };

  export function io(
    uri?: string,
    options?: Record<string, unknown>,
  ): Socket;
}
