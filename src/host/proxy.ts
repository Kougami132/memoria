import net from "node:net";

export const SUPPORTED_PROXY_SCHEMES = new Set(["http", "https", "socks5", "socks5h"]);

export class ProxyError extends Error {}

export class ProxyServerUnreachableError extends ProxyError {}

export class ProxyAuthError extends ProxyError {}

export class TargetUnreachableViaProxyError extends ProxyError {}

export interface ParsedProxyUrl {
  scheme: "http" | "https" | "socks5" | "socks5h";
  hostname: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseAndValidateProxyUrl(rawUrl?: string | null): ParsedProxyUrl | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  const raw = rawUrl.trim();
  const schemeMatch = raw.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (!schemeMatch) {
    throw new Error(`Unsupported proxy scheme. Supported schemes: http, https, socks5, socks5h`);
  }
  const scheme = schemeMatch[1].toLowerCase();
  if (!SUPPORTED_PROXY_SCHEMES.has(scheme)) {
    throw new Error(
      `Unsupported proxy scheme '${scheme}'. Supported schemes: http, https, socks5, socks5h`,
    );
  }

  let parsed: URL;
  try {
    // Normalize socks5h:// -> http:// temporarily if needed by URL parser, though Node URL handles custom schemes
    parsed = new URL(raw);
  } catch (err: any) {
    throw new Error(`Invalid proxy URL: ${err?.message || raw}`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error("Proxy URL must include a host");
  }

  let port: number;
  if (parsed.port) {
    port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid proxy port: ${parsed.port}`);
    }
  } else {
    port = scheme === "http" || scheme === "https" ? 8080 : 1080;
  }

  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  return {
    scheme: scheme as ParsedProxyUrl["scheme"],
    hostname,
    port,
    username,
    password,
  };
}

export function validateProxyUrl(url?: string | null): string {
  const p = parseAndValidateProxyUrl(url);
  if (!p) return "";
  let auth = "";
  if (p.username !== undefined) {
    auth = p.username;
    if (p.password !== undefined) {
      auth += `:${p.password}`;
    }
    auth += "@";
  }
  const hostStr = p.hostname.includes(":") && !p.hostname.startsWith("[") ? `[${p.hostname}]` : p.hostname;
  return `${p.scheme}://${auth}${hostStr}:${p.port}`;
}

export function maskProxyUrl(url?: string | null): string {
  if (!url || !url.trim()) return "";
  try {
    const p = parseAndValidateProxyUrl(url);
    if (!p) return "";
    if (p.password === undefined) return validateProxyUrl(url);
    const hostStr =
      p.hostname.includes(":") && !p.hostname.startsWith("[") ? `[${p.hostname}]` : p.hostname;
    return `${p.scheme}://${p.username ?? ""}:******@${hostStr}:${p.port}`;
  } catch {
    return url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:******@");
  }
}

export function mergeProxyUrl(newUrl?: string | null, oldUrl?: string | null): string {
  if (newUrl === undefined || newUrl === null) {
    return oldUrl || "";
  }
  const trimmed = newUrl.trim();
  if (!trimmed) return "";
  if (!oldUrl || !oldUrl.trim()) return validateProxyUrl(trimmed);

  const pNew = parseAndValidateProxyUrl(trimmed);
  if (!pNew) return "";
  if (pNew.password === "******") {
    const pOld = parseAndValidateProxyUrl(oldUrl);
    if (pOld?.password !== undefined) {
      const hostStr =
        pNew.hostname.includes(":") && !pNew.hostname.startsWith("[")
          ? `[${pNew.hostname}]`
          : pNew.hostname;
      return `${pNew.scheme}://${pNew.username ?? pOld.username ?? ""}:${pOld.password}@${hostStr}:${pNew.port}`;
    }
  }
  return validateProxyUrl(trimmed);
}

function readSocketChunk(socket: net.Socket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Socket read timeout"));
    }, timeoutMs);

    const onData = (data: Buffer) => {
      cleanup();
      resolve(data);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed unexpectedly"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };

    socket.once("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

/**
 * Establish a TCP tunnel through an HTTP CONNECT or SOCKS5 (remote DNS rdns=true) proxy.
 */
export async function createProxyTunnelSocket(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
  timeoutMs = 5000,
): Promise<net.Socket> {
  const proxy = parseAndValidateProxyUrl(proxyUrl);
  if (!proxy) {
    throw new Error("proxy_url cannot be empty");
  }

  // Step 1: Connect to the proxy server itself
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.createConnection({
      host: proxy.hostname.replace(/^\[|\]$/g, ""),
      port: proxy.port,
    });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new ProxyServerUnreachableError(`无法连接至代理服务器: 连接 ${proxy.hostname}:${proxy.port} 超时`));
    }, timeoutMs);

    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (err) => {
      clearTimeout(timer);
      s.destroy();
      reject(new ProxyServerUnreachableError(`无法连接至代理服务器: ${err.message}`));
    });
  });

  try {
    if (proxy.scheme === "http" || proxy.scheme === "https") {
      // HTTP CONNECT handshake
      let headers = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (proxy.username !== undefined) {
        const token = Buffer.from(`${proxy.username}:${proxy.password ?? ""}`).toString("base64");
        headers += `Proxy-Authorization: Basic ${token}\r\n`;
      }
      headers += "\r\n";
      socket.write(headers);

      const respBuf = await readSocketChunk(socket, timeoutMs);
      const statusLine = respBuf.toString("latin1").split("\r\n")[0] || "";
      const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);
      const statusCode = match ? Number(match[1]) : 0;
      if (statusCode === 407) {
        throw new ProxyAuthError(`代理认证失败: ${statusLine}`);
      }
      if (statusCode !== 200) {
        throw new TargetUnreachableViaProxyError(
          `通过代理连接目标主机失败: ${statusLine || "未知代理响应"}`,
        );
      }
      return socket;
    }

    // SOCKS5 handshake with remote DNS (ATYP = 0x03 Domain Name)
    const hasAuth = proxy.username !== undefined;
    const greeting = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
    socket.write(greeting);

    const methodResp = await readSocketChunk(socket, timeoutMs);
    if (methodResp.length < 2 || methodResp[0] !== 0x05) {
      throw new ProxyServerUnreachableError("无法连接至代理服务器: 无效的 SOCKS5 握手响应");
    }
    const chosenMethod = methodResp[1];
    if (chosenMethod === 0xff) {
      throw new ProxyAuthError("代理认证失败: SOCKS5 服务器拒绝认证方式");
    }
    if (chosenMethod === 0x02) {
      const userBuf = Buffer.from(proxy.username ?? "", "utf8");
      const passBuf = Buffer.from(proxy.password ?? "", "utf8");
      const authReq = Buffer.concat([
        Buffer.from([0x01, userBuf.length]),
        userBuf,
        Buffer.from([passBuf.length]),
        passBuf,
      ]);
      socket.write(authReq);
      const authResp = await readSocketChunk(socket, timeoutMs);
      if (authResp.length < 2 || authResp[1] !== 0x00) {
        throw new ProxyAuthError("代理认证失败: SOCKS5 用户名或密码错误");
      }
    }

    // SOCKS5 CONNECT request using ATYP = 0x03 (Remote DNS resolution, rdns = true)
    const hostBytes = Buffer.from(targetHost, "utf8");
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(targetPort, 0);
    const connectReq = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
      hostBytes,
      portBytes,
    ]);
    socket.write(connectReq);

    const connectResp = await readSocketChunk(socket, timeoutMs);
    if (connectResp.length < 2 || connectResp[0] !== 0x05 || connectResp[1] !== 0x00) {
      const rep = connectResp[1] ?? 0xff;
      throw new TargetUnreachableViaProxyError(
        `通过代理连接目标主机失败: SOCKS5 建连错误码 0x${rep.toString(16)}`,
      );
    }
    return socket;
  } catch (err) {
    socket.destroy();
    if (err instanceof ProxyError) throw err;
    throw new TargetUnreachableViaProxyError(
      `通过代理连接目标主机失败: ${(err as Error)?.message || String(err)}`,
    );
  }
}
