import { WebSocketServer } from 'ws';

/**
 * In-memory stand-in for emu-webapp-server's websocket protocol, for tests.
 * Like the real server it stores the whole annotation on SAVEBUNDLE and
 * serializes it with JSON.stringify(…, null, 2).
 */
export class MockEmuServer {
  readonly files = new Map<string, string>();
  readonly requests: any[] = [];
  bundleList: any[] = [];
  dbConfig: any = {};
  private wss!: WebSocketServer;

  get url() {
    return `ws://127.0.0.1:${(this.wss.address() as any).port}`;
  }

  setBundle(session: string, name: string, annotation: unknown) {
    this.files.set(`${session}/${name}`, JSON.stringify(annotation, null, 2));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, resolve);
      this.wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const req = JSON.parse(String(raw));
          this.requests.push(req);
          const ok = (data: unknown) =>
            ws.send(
              JSON.stringify({
                callbackID: req.callbackID,
                data,
                status: { type: 'SUCCESS', message: '' },
              }),
            );
          const fail = (message: string) =>
            ws.send(
              JSON.stringify({
                callbackID: req.callbackID,
                status: { type: 'ERROR', message },
              }),
            );
          switch (req.type) {
            case 'GETGLOBALDBCONFIG':
              return ok(this.dbConfig);
            case 'GETBUNDLELIST':
              return ok(this.bundleList);
            case 'GETBUNDLE': {
              const f = this.files.get(`${req.session}/${req.name}`);
              if (!f) return fail('Error reading annotation file.');
              return ok({
                annotation: JSON.parse(f),
                mediaFile: {
                  encoding: 'GETURL',
                  data: `https://artic.example/file/${req.session}/${req.name}.wav`,
                },
                ssffFiles: [],
              });
            }
            case 'SAVEBUNDLE': {
              const key = `${req.data.session}/${req.data.annotation.name}`;
              if (!this.files.has(key)) return fail('Bundle not found.');
              this.files.set(key, JSON.stringify(req.data.annotation, null, 2));
              return ok('');
            }
            default:
              return fail('Unknown command');
          }
        });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.clients.forEach((c) => c.terminate());
      this.wss.close(() => resolve());
    });
  }
}
