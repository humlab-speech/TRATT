import { createHash } from 'crypto';
import { WebSocketServer } from 'ws';

/**
 * In-memory stand-in for the VISP annotation server's websocket protocol, for tests.
 * Like the real server it stores the whole annotation on SAVEBUNDLE and
 * serializes it with JSON.stringify(…, null, 2), reports each file's version
 * (sha256), answers WHOAMI, and refuses a save whose baseVersion is not the
 * current one or whose expectedUser is not the signed-in user.
 */
export class MockEmuServer {
  readonly files = new Map<string, string>();
  readonly requests: any[] = [];
  bundleList: any[] = [];
  dbConfig: any = {};
  /** Who is signed in, as WHOAMI answers and SAVEBUNDLE checks. */
  username = 'some_user';
  /** Runs just before a SAVEBUNDLE is checked, e.g. to save "in Artic" meanwhile. */
  beforeSave?: () => void;
  private wss!: WebSocketServer;

  static version(file: string) {
    return createHash('sha256').update(file).digest('hex');
  }

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
            case 'WHOAMI':
              return ok({ username: this.username });
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
                // like annotation-server: only for a client that asks
                ...(req.withVersion === true
                  ? { annotationVersion: MockEmuServer.version(f) }
                  : {}),
              });
            }
            case 'SAVEBUNDLE': {
              const key = `${req.data.session}/${req.data.annotation.name}`;
              if (!this.files.has(key)) return fail('Bundle not found.');
              this.beforeSave?.();
              if (
                req.data.expectedUser !== undefined &&
                req.data.expectedUser !== this.username
              ) {
                return fail(
                  'Signed in to Visp as a different user than the one who made these changes.',
                );
              }
              if (
                req.data.baseVersion !== undefined &&
                req.data.baseVersion !==
                  MockEmuServer.version(this.files.get(key)!)
              ) {
                return fail(
                  'STALE: the bundle was changed in Visp since it was opened.',
                );
              }
              const file = JSON.stringify(req.data.annotation, null, 2);
              this.files.set(key, file);
              return ok({ annotationVersion: MockEmuServer.version(file) });
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
