/**
 * Client for the EMU-webApp websocket protocol spoken by `emu-webapp-server`:
 * JSON requests `{type, callbackID, ...}` paired with responses carrying the
 * same `callbackID` and `status.type` SUCCESS | ERROR.
 */

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export class EmuServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmuServerError';
  }
}

export class EmuConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmuConnectionError';
  }
}

export interface EmuClientOptions {
  createSocket?: (url: string) => WebSocketLike;
  /** Throws to stop a (re)connect, e.g. when another tab switched project. */
  beforeConnect?: () => void;
  timeoutMs?: number;
  /** Delays between connection attempts; one attempt follows each entry. */
  backoffMs?: number[];
}

const OPEN = 1;

export class EmuWebsocketClient {
  private socket: WebSocketLike | null = null;
  private connecting: Promise<WebSocketLike> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly url: string,
    private readonly options: EmuClientOptions = {},
  ) {}

  async request<T = unknown>(
    type: string,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    const socket = await this.ensureConnected();
    const callbackID = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callbackID);
        reject(new EmuConnectionError(`${type} timed out`));
      }, this.options.timeoutMs ?? 30000);
      this.pending.set(callbackID, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type, callbackID, ...fields }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(callbackID);
        reject(new EmuConnectionError(String(e)));
      }
    });
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.failAll(new EmuConnectionError('Connection closed'));
    socket?.close();
  }

  private async ensureConnected(): Promise<WebSocketLike> {
    if (this.socket && this.socket.readyState === OPEN) {
      return this.socket;
    }
    if (!this.connecting) {
      this.connecting = this.connectWithBackoff().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connectWithBackoff(): Promise<WebSocketLike> {
    const delays = this.options.backoffMs ?? [250, 1000, 3000];
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      // A guard failure is final, not retried.
      this.options.beforeConnect?.();
      try {
        return await this.openSocket();
      } catch (e) {
        lastError = e;
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw new EmuConnectionError(
      `Cannot reach ${this.url}: ${String(lastError)}`,
    );
  }

  private openSocket(): Promise<WebSocketLike> {
    return new Promise((resolve, reject) => {
      const socket = (
        this.options.createSocket ??
        ((u: string) => new WebSocket(u) as unknown as WebSocketLike)
      )(this.url);
      let opened = false;
      socket.onopen = () => {
        opened = true;
        this.socket = socket;
        resolve(socket);
      };
      socket.onerror = () => {
        if (!opened) reject(new Error('connection failed'));
      };
      socket.onmessage = (ev) => this.onMessage(ev.data);
      socket.onclose = () => {
        if (!opened) {
          reject(new Error('connection closed'));
          return;
        }
        if (this.socket === socket) {
          this.socket = null;
        }
        this.failAll(new EmuConnectionError('Connection lost'));
      };
    });
  }

  private onMessage(raw: unknown) {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const entry = this.pending.get(msg?.callbackID);
    if (!entry) return;
    this.pending.delete(msg.callbackID);
    clearTimeout(entry.timer);
    if (msg.status?.type === 'SUCCESS') {
      entry.resolve(msg.data);
    } else {
      entry.reject(new EmuServerError(msg.status?.message ?? 'Request failed'));
    }
  }

  private failAll(error: Error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
