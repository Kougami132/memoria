import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * 系统日志文件的唯一解析入口：写入端与 `/api/logs/system` 读取端共用，
 * 避免两边各算一套路径导致“写了但读不到”。
 */
export function resolveLogPath(): string {
  const fromEnv = process.env.LOG_PATH?.trim();
  return fromEnv ? resolve(fromEnv) : resolve("data", "memoria.log");
}

/**
 * 行格式沿用旧版 `时间 级别 组件 — 消息`，与 `parseSystemLogLines` 的正则对齐。
 * 时间使用本地时间（不带时区后缀），因为前端 `formatTime` 会按本地时间解析该字符串。
 */
function localTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function createLogger(component: string): Logger {
  const write = (level: LogLevel) => (message: string) => {
    const path = resolveLogPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${localTimestamp()} ${level.padEnd(8)} ${component} — ${message}\n`, "utf8");
  };
  return {
    info: write("INFO"),
    warn: write("WARN"),
    error: write("ERROR"),
  };
}
