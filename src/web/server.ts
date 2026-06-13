import { serve } from "bun";
import type { Server, ServerWebSocket } from "bun";
import { join, resolve } from "path";
import { existsSync } from "fs";

interface WsData {
  clientId: string;
}

export interface WebServerOptions {
  port: number;
  host: string;
  staticDir: string;
  onConnect: (clientId: string) => void;
  onDisconnect: (clientId: string) => void;
}

export class WebServer {
  private server: Server<WsData> | null = null;
  private clients: Map<string, ServerWebSocket<WsData>> = new Map();
  private options: WebServerOptions;
  private inputResolve: ((value: string) => void) | null = null;
  private messageQueue: string[] = [];
  private authToken: string;

  constructor(options: WebServerOptions) {
    this.options = options;
    this.authToken = crypto.randomUUID();
  }

  start(): void {
    const { port, host, staticDir } = this.options;

    this.server = serve({
      port,
      hostname: host,
      fetch: async (req: Request, server: Server<WsData>) => {
        const url = new URL(req.url);

        if (url.pathname === "/ws") {
          const token = url.searchParams.get("token");
          if (token !== this.authToken) {
            return new Response("Unauthorized", { status: 401 });
          }
          const clientId = crypto.randomUUID();
          const upgraded = server.upgrade(req, { data: { clientId } });
          if (upgraded) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = resolve(join(staticDir, filePath));

        if (!fullPath.startsWith(resolve(staticDir))) {
          return new Response("Forbidden", { status: 403 });
        }

        if (existsSync(fullPath)) {
          const file = Bun.file(fullPath);
          const content = await file.arrayBuffer();
          const ext = filePath.split(".").pop() ?? "";
          const mimeTypes: Record<string, string> = {
            html: "text/html",
            css: "text/css",
            js: "application/javascript",
            json: "application/json",
            png: "image/png",
            jpg: "image/jpeg",
            svg: "image/svg+xml",
          };

          return new Response(content, {
            headers: { "Content-Type": mimeTypes[ext] ?? "text/plain" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open: (ws: ServerWebSocket<WsData>) => {
          const clientId = ws.data?.clientId ?? crypto.randomUUID();
          this.clients.set(clientId, ws);
          this.options.onConnect(clientId);
          ws.send(JSON.stringify({ type: "connected", content: clientId, clients: this.clients.size }));
        },
        message: (ws: ServerWebSocket<WsData>, message: string | Buffer) => {
          try {
            const data = JSON.parse(message.toString());
            if (typeof data !== "object" || data === null || typeof data.type !== "string") {
              return;
            }
            if (data.type === "message" || data.type === "command") {
              if (typeof data.content !== "string") return;
              if (this.inputResolve) {
                const resolve = this.inputResolve;
                this.inputResolve = null;
                resolve(data.content);
              } else {
                this.messageQueue.push(data.content);
              }
            }
          } catch (e) {
            console.error("WebSocket message parse error:", e);
          }
        },
        close: (ws: ServerWebSocket<WsData>) => {
          try {
            const clientId = ws.data?.clientId;
            if (clientId) {
              this.clients.delete(clientId);
              this.options.onDisconnect(clientId);
            }
          } catch (err) {
            console.error("WebSocket close handler error:", err);
          }
        },
      },
    });

    console.log(`Web 服务器已启动: http://${host}:${port}`);
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    console.log(`连接 URL: http://${displayHost}:${port}/?token=${this.authToken}`);
  }

  broadcast(data: { type: string; content: string }): void {
    const message = JSON.stringify(data);
    for (const [clientId, ws] of this.clients) {
      try {
        ws.send(message);
      } catch (err) {
        console.error(`broadcast 失败 (${clientId}):`, err);
        this.clients.delete(clientId);
      }
    }
  }

  send(clientId: string, data: { type: string; content: string }): void {
    const ws = this.clients.get(clientId);
    if (ws) {
      ws.send(JSON.stringify(data));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getAuthToken(): string {
    return this.authToken;
  }

  waitForInput(): Promise<string> {
    // 如果队列中有消息，立即返回
    const queued = this.messageQueue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    // 防止多个调用者同时等待
    if (this.inputResolve) {
      throw new Error("waitForInput: 已有等待者，请勿并发调用");
    }
    return new Promise((resolve) => {
      this.inputResolve = resolve;
    });
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }
}
