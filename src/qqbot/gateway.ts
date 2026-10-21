const TOKEN_ENDPOINT = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

// 官方事件订阅：1<<25 C2C、1<<30 群@、1<<12 群/C2C 相关、1<<26 交互。
// QQ 拒绝 intents=0（4013），因此默认值必须是真实的事件位集合。
export const DEFAULT_GATEWAY_INTENTS = (1 << 25) | (1 << 30) | (1 << 12) | (1 << 26);

const READY_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** 不可重试的网关错误：凭据、intents 或 Bot 状态被平台拒绝。 */
export class QQGatewayFatalError extends Error {}

export interface QQGatewayHandlers {
  onReady?: (sessionId: string | null) => void;
  onEvent?: (event: any) => void;
  onDisconnect?: (reason: string) => void;
  onFatal?: (error: QQGatewayFatalError) => void;
}

export interface QQGatewayDeps {
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
}

export class QQGateway {
  private readonly appId: string;
  private readonly clientSecret: string;
  private readonly intents: number;
  private readonly handlers: QQGatewayHandlers;
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl: typeof WebSocket;

  private loop: Promise<void> | null = null;
  private stopped = false;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private sequence: number | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private msgSeq = 0;
  /** 允许 stop() 立即结束当前连接尝试，即使 socket 不再发出 close 事件。 */
  private settleConnection: (() => void) | null = null;
  private wakeFromDelay: (() => void) | null = null;

  constructor(
    options: { appId: string; clientSecret: string; intents: number },
    handlers: QQGatewayHandlers = {},
    deps: QQGatewayDeps = {},
  ) {
    this.appId = options.appId;
    this.clientSecret = options.clientSecret;
    this.intents = options.intents || DEFAULT_GATEWAY_INTENTS;
    this.handlers = handlers;
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
    this.WebSocketImpl = deps.WebSocket ?? globalThis.WebSocket;
  }

  start(): void {
    if (this.loop) return;
    this.stopped = false;
    this.loop = this.run().finally(() => {
      this.loop = null;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.sessionId = null;
    this.sequence = null;
    try {
      this.ws?.close(1000, "client shutdown");
    } catch {
      // 已关闭
    }
    this.ws = null;
    this.settleConnection?.();
    this.wakeFromDelay?.();
    await this.loop?.catch(() => {});
    this.loop = null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeFromDelay = null;
        resolve();
      }, ms);
      this.wakeFromDelay = () => {
        clearTimeout(timer);
        this.wakeFromDelay = null;
        resolve();
      };
    });
  }

  private async run(): Promise<void> {
    let backoff = 1_000;
    while (!this.stopped) {
      let ready = false;
      try {
        const token = await this.accessToken();
        const url = await this.gatewayUrl(token);
        ready = await this.connect(token, url);
      } catch (err) {
        if (err instanceof QQGatewayFatalError) {
          this.handlers.onFatal?.(err);
          return;
        }
        if (this.stopped) return;
        this.handlers.onDisconnect?.(err instanceof Error ? err.message : String(err));
      }
      if (this.stopped) return;
      // 只有真正建立会话后再重置退避，避免握手失败时高频重试。
      backoff = ready ? 1_000 : Math.min(backoff * 2, MAX_BACKOFF_MS);
      await this.delay(backoff);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const resp = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, any>;
    const token = body.access_token;
    if (!resp.ok || !token) {
      const detail = [body.code, body.message ?? body.msg].filter(Boolean).join(" ") || `HTTP ${resp.status}`;
      throw new QQGatewayFatalError(`QQ 访问令牌获取失败: ${detail}`);
    }
    const expiresInMs = Math.max(60, Number(body.expires_in) || 7200) * 1000;
    this.token = { value: String(token), expiresAt: Date.now() + expiresInMs - TOKEN_REFRESH_MARGIN_MS };
    return this.token.value;
  }

  private invalidateToken(): void {
    this.token = null;
  }

  private async gatewayUrl(token: string): Promise<string> {
    const resp = await this.fetchImpl(`${API_BASE}/gateway`, {
      headers: { Authorization: `QQBot ${token}` },
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, any>;
    if (!resp.ok || !body.url) {
      throw new Error(`QQ 网关地址获取失败: HTTP ${resp.status}`);
    }
    return String(body.url);
  }

  /** 建立一次 WebSocket 会话；返回本次是否成功收到 READY/RESUMED。 */
  private connect(token: string, url: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const ws = new this.WebSocketImpl(url);
      this.ws = ws;
      let settled = false;
      let ready = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.settleConnection = null;
        if (heartbeat) clearInterval(heartbeat);
        clearTimeout(readyTimer);
        if (this.ws === ws) this.ws = null;
        try {
          ws.close();
        } catch {
          // 已关闭
        }
        if (error) reject(error);
        else resolve(ready);
      };
      this.settleConnection = () => finish();

      const readyTimer = setTimeout(
        () => finish(new Error(`QQ 网关在 ${READY_TIMEOUT_MS / 1000} 秒内未返回 READY`)),
        READY_TIMEOUT_MS,
      );

      const send = (payload: unknown) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          // 发送失败由 close 事件统一收敛
        }
      };

      ws.addEventListener("message", (ev: MessageEvent) => {
        let event: any;
        try {
          event = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (event.s !== undefined && event.s !== null) this.sequence = event.s;

        switch (event.op) {
          case 10: {
            const interval = Number(event.d?.heartbeat_interval) || 45_000;
            heartbeat = setInterval(() => send({ op: 1, d: this.sequence }), interval);
            if (this.sessionId !== null) {
              send({
                op: 6,
                d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.sequence },
              });
            } else {
              send({
                op: 2,
                d: {
                  token: `QQBot ${token}`,
                  intents: this.intents,
                  shard: [0, 1],
                  properties: { $os: process.platform, $browser: "memoria", $device: "memoria" },
                },
              });
            }
            return;
          }
          case 0: {
            if (event.t === "READY" || event.t === "RESUMED") {
              ready = true;
              // 建连阶段的超时看门狗必须在 READY 后停掉，否则会主动搞断已就绪的长连接。
              clearTimeout(readyTimer);
              this.sessionId = event.d?.session_id ?? this.sessionId;
              this.handlers.onReady?.(this.sessionId);
            }
            this.handlers.onEvent?.(event);
            return;
          }
          case 7:
            // 服务端要求重连：这是一次非正常结束，必须让 run() 感知并回报 onDisconnect。
            finish(new Error("QQ 网关要求重连 (op 7)"));
            return;
          case 9:
            // false 表示会话不可恢复，必须重新 Identify。
            if (!event.d) {
              this.sessionId = null;
              this.sequence = null;
            }
            finish(new Error(`QQ 网关会话失效 (op 9, resumable=${Boolean(event.d)})`));
            return;
          default:
            return;
        }
      });

      ws.addEventListener("close", (ev: any) => {
        const code = ev?.code as number | undefined;
        if (code === 4013 || code === 4014) {
          finish(new QQGatewayFatalError(`QQ 网关拒绝了当前事件订阅 (close ${code})`));
          return;
        }
        if (code === 4914 || code === 4915) {
          finish(new QQGatewayFatalError(`QQ 机器人当前不可用 (close ${code}: 未上线/沙箱限制)`));
          return;
        }
        if (code === 4004) this.invalidateToken();
        // 主动 stop() 不回报；其余任何服务端/网络断开都要让上层知道连接已中断。
        if (this.stopped) finish();
        else finish(new Error(`QQ 网关连接已断开 (close ${code ?? "unknown"})`));
      });

      ws.addEventListener("error", () => finish(new Error("QQ 网关 WebSocket 连接异常")));
    });
  }

  /** 通过官方 REST 接口发送一条消息（自动按 msg_seq 去重）。 */
  async sendMessage(params: {
    contextType: "c2c" | "group";
    targetId: string;
    content: string;
    replyTo?: string;
  }): Promise<void> {
    const send = async (token: string) =>
      this.fetchImpl(
        params.contextType === "c2c"
          ? `${API_BASE}/v2/users/${params.targetId}/messages`
          : `${API_BASE}/v2/groups/${params.targetId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `QQBot ${token}` },
          body: JSON.stringify({
            markdown: { content: params.content },
            msg_type: 2,
            msg_seq: ++this.msgSeq,
            ...(params.replyTo ? { msg_id: params.replyTo } : {}),
          }),
        },
      );

    let resp = await send(await this.accessToken());
    if (resp.status === 401) {
      this.invalidateToken();
      resp = await send(await this.accessToken());
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`QQ 消息发送失败: HTTP ${resp.status} ${detail.slice(0, 200)}`);
    }
  }
}
