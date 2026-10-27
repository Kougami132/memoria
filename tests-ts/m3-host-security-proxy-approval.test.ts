import { generateKeyPairSync } from "node:crypto";
import net from "node:net";
import ssh2 from "ssh2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

describe("M3: Controlled Hosts, AES-GCM Encryption, Proxy Tunneling & pi-durable Approval Flow", () => {
  let db: AppDatabase;
  let faux: FauxProviderHandle;
  let runtime: MemoriaAgentRuntime;
  let app: ReturnType<typeof createApp>;
  let executedCommands: Array<{ hostId: string; command: string }>;

  beforeEach(async () => {
    executedCommands = [];
    db = new AppDatabase(":memory:");
    faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async (host, cmd) => {
        executedCommands.push({ hostId: host.id, command: cmd });
        return {
          exitCode: 0,
          stdout: `[${host.name}] executed: ${cmd}`,
          stderr: "",
        };
      },
    });
    app = createApp(runtime);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("encrypts credentials and proxy_url at rest, masks password in API, and preserves password on ****** update", async () => {
    const createRes = await app.request("/api/hosts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Prod DB Node",
        host: "10.0.1.25",
        port: 22,
        username: "ubuntu",
        auth_type: "password",
        credential: "my-super-secret-ssh-pass",
        proxy_url: "socks5://proxyuser:proxypass123@127.0.0.1:1080",
        default_cwd: "/srv/app",
        security_mode: "ask_confirmation",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as any;
    expect(created.credential_set).toBe(true);
    expect(created.credential).toBeUndefined();
    expect(created.proxy_url).toBe("socks5://proxyuser:******@127.0.0.1:1080");
    expect(created.proxy_url_set).toBe(true);

    // Verify raw SQLite row is AES-256-GCM encrypted
    const rawRow = db.raw.prepare("SELECT credential, proxy_url FROM hosts WHERE id = ?").get(created.id) as any;
    expect(rawRow.credential.startsWith("enc:v1:")).toBe(true);
    expect(rawRow.credential).not.toContain("my-super-secret-ssh-pass");
    expect(rawRow.proxy_url.startsWith("enc:v1:")).toBe(true);
    expect(rawRow.proxy_url).not.toContain("proxypass123");

    // Update host description while submitting masked proxy_url "socks5://proxyuser:******@127.0.0.1:1080"
    const updateRes = await app.request(`/api/hosts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Updated description",
        proxy_url: "socks5://proxyuser:******@127.0.0.1:1080",
      }),
    });
    expect(updateRes.status).toBe(200);

    // Verify decrypted proxy_url still retains "proxypass123"
    const decrypted = runtime.hostManager.getDecryptedHost(created.id)!;
    expect(decrypted.proxy_url).toBe("socks5://proxyuser:proxypass123@127.0.0.1:1080");
    expect(decrypted.credential).toBe("my-super-secret-ssh-pass");
  });

  it("performs stratified proxy connection diagnostics (unreachable proxy vs 407 auth error)", async () => {
    // Temporarily disable customRunner to test real socket diagnostics
    runtime.hostManager.setCustomRunner(undefined);

    // 1. Proxy server unreachable on closed local port
    const hostUnreachable = runtime.hostManager.createHost({
      name: "Unreachable Proxy Host",
      host: "10.0.0.1",
      username: "root",
      proxy_url: "http://127.0.0.1:59999",
    });
    const res1 = await runtime.hostManager.testConnection(hostUnreachable.id);
    expect(res1.ok).toBe(false);
    expect(res1.message).toContain("无法连接至代理服务器");

    // 2. Mock HTTP proxy returning 407 Proxy Authentication Required
    const proxyServer = net.createServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
        socket.end();
      });
    });
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxyServer.address() as net.AddressInfo).port;

    try {
      const hostAuthFail = runtime.hostManager.createHost({
        name: "Auth Fail Proxy Host",
        host: "10.0.0.1",
        username: "root",
        proxy_url: `http://user:wrongpass@127.0.0.1:${proxyPort}`,
      });
      const res2 = await runtime.hostManager.testConnection(hostAuthFail.id);
      expect(res2.ok).toBe(false);
      expect(res2.message).toContain("代理认证失败");
    } finally {
      proxyServer.close();
    }
  });

  it("authenticates via ssh2 with password credential and executes command or reports auth failure", async () => {
    runtime.hostManager.setCustomRunner(undefined);

    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    const sshServer = new ssh2.Server({ hostKeys: [privateKey] }, (client) => {
      client
        .on("authentication", (ctx) => {
          if (ctx.method === "password" && ctx.username === "root" && ctx.password === "nas-pass-secret") {
            ctx.accept();
          } else {
            ctx.reject(["password"]);
          }
        })
        .on("ready", () => {
          client.on("session", (accept) => {
            const session = accept();
            session.on("exec", (acceptExec, _rejectExec, info) => {
              const stream = acceptExec();
              if (info.command === "uname -sr") {
                stream.write("Linux MockNAS 6.1.0\n");
              } else {
                stream.write(`executed: ${info.command}\n`);
              }
              stream.exit(0);
              stream.end();
            });
          });
        });
    });

    await new Promise<void>((resolve) => sshServer.listen(0, "127.0.0.1", resolve));
    const sshPort = (sshServer.address() as net.AddressInfo).port;

    try {
      // 1. Success with valid credentials
      const validHost = runtime.hostManager.createHost({
        name: "Valid NAS Host",
        host: "127.0.0.1",
        port: sshPort,
        username: "root",
        auth_type: "password",
        credential: "nas-pass-secret",
      });

      const testOk = await runtime.hostManager.testConnection(validHost.id);
      expect(testOk.ok).toBe(true);
      expect(testOk.status).toBe("active");
      expect(testOk.os_info).toBe("Linux MockNAS 6.1.0");

      const runOk = await runtime.hostManager.runOnHost(validHost.id, "uptime");
      expect(runOk.exitCode).toBe(0);
      expect(runOk.output).toContain("executed: uptime");

      // 2. Failure with invalid password
      const invalidHost = runtime.hostManager.createHost({
        name: "Invalid NAS Host",
        host: "127.0.0.1",
        port: sshPort,
        username: "root",
        auth_type: "password",
        credential: "wrong-password",
      });

      const testBad = await runtime.hostManager.testConnection(invalidHost.id);
      expect(testBad.ok).toBe(false);
      expect(testBad.status).toBe("error");
      expect(testBad.message).toContain("SSH 认证失败");

      const runBad = await runtime.hostManager.runOnHost(invalidHost.id, "uptime");
      expect(runBad.exitCode).toBe(255);
      expect(runBad.output).toContain("SSH 认证失败");
    } finally {
      sshServer.close();
    }
  });

  it("enforces CommandGuard blacklist & suspends/resumes ask_confirmation commands in pi-durable", async () => {
    const host = runtime.hostManager.createHost({
      name: "App Server",
      host: "192.168.1.50",
      username: "ops",
      default_cwd: "/var/www",
      security_mode: "ask_confirmation",
    });

    // 1. Dangerous command (rm -rf /) is hard-blocked immediately without approval prompt
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("host_exec", { host_id: host.id, command: "rm -rf /" }, { id: "call_danger" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("高危命令已被系统安全策略拦截。")]),
    ]);

    const dangerRes = await app.request("/api/conversations/new/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "清理根目录",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
        wait: true,
      }),
    });
    const dangerBody = (await dangerRes.json()) as any;
    const dangerToolSpan = dangerBody.messages[1].trace.spans.find((s: any) => s.type === "tool");
    expect(dangerToolSpan.error).toContain("potentially dangerous pattern");
    expect(executedCommands.length).toBe(0);

    // 2. Non-whitelist command (systemctl restart nginx) in ask_confirmation mode suspends until approved
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "host_exec",
            { host_id: host.id, command: "systemctl restart nginx" },
            { id: "call_restart" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("已获批准并成功重启 Nginx。")]),
    ]);

    // Start the submission asynchronously (without wait: true) so we can approve it while suspended
    const admitRes = await app.request("/api/conversations/new/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "重启 Nginx 服务",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
      }),
    });
    const admitBody = (await admitRes.json()) as any;
    const convId = admitBody.conversation.id;

    // Poll until the pending approval is registered
    let approvalId = "";
    for (let i = 0; i < 40; i++) {
      const pending = runtime.hostManager.approvalManager.listPendingApprovals();
      if (pending.length > 0) {
        approvalId = pending[0].id;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(approvalId).toMatch(/^appr_/);
    expect(executedCommands.length).toBe(0);

    // Approve the command via REST API
    const approveRes = await app.request(`/api/hosts/approvals/${approvalId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    expect(approveRes.status).toBe(200);

    // Wait for conversation to become idle
    const conv = await runtime.harness.conversation(
      admitBody.conversation.durableId,
      BACKGROUND_CONTEXT,
    );
    await conv!.waitForIdle(BACKGROUND_CONTEXT);

    expect(executedCommands.length).toBe(1);
    expect(executedCommands[0].command).toBe("cd /var/www && systemctl restart nginx");

    const finalMsgs = await runtime.getConversationMessages(convId);
    expect(finalMsgs![1].content).toContain("已获批准并成功重启 Nginx");
  });
});
