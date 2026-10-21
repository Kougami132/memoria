import { describe, expect, it } from "vitest";
import { QQGateway } from "../src/qqbot/gateway.ts";

class FakeWS extends EventTarget {
  static inst: FakeWS[] = [];
  sent: any[] = [];
  constructor(public url: string) {
    super();
    FakeWS.inst.push(this);
    queueMicrotask(() => this.emit({ op: 10, d: { heartbeat_interval: 45000 } }));
  }
  emit(p: unknown) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(p) }));
  }
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  /** 模拟服务端主动断开 */
  serverClose(code = 1000) {
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}

const fakeFetch = (async (input: any) => {
  const u = new URL(String(input?.url ?? input));
  if (u.host === "bots.qq.com") {
    return new Response(JSON.stringify({ access_token: "t", expires_in: 7200 }), { status: 200 });
  }
  return new Response(JSON.stringify({ url: "wss://api.sgroup.qq.com/websocket/" }), { status: 200 });
}) as any;

describe("网关断开必须回报 onDisconnect", () => {
  it("READY 后服务端断开，onDisconnect 必须被调用", async () => {
    FakeWS.inst = [];
    const events: string[] = [];
    const gw = new QQGateway(
      { appId: "1", clientSecret: "s", intents: 1 },
      { onReady: () => events.push("ready"), onDisconnect: (r) => events.push(`disconnect:${r}`) },
      { fetch: fakeFetch, WebSocket: FakeWS as any },
    );
    (gw as any)["stopped"] = true; // 阻止重连循环继续，便于观察单次断开

    gw.start();
    for (let i = 0; i < 100 && !FakeWS.inst.length; i++) await new Promise((r) => setTimeout(r, 10));
    const ws = FakeWS.inst[0];
    // 触发 READY
    ws.emit({ op: 0, s: 1, t: "READY", d: { session_id: "s1" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("ready");

    // 服务端断开
    ws.serverClose();
    await new Promise((r) => setTimeout(r, 50));
    await gw.stop();
    expect(events.some((e) => e.startsWith("disconnect:"))).toBe(true);
  });
});
