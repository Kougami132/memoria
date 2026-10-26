import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 系统日志写入端上线后，任何创建 runtime 的测试都会落盘。
// 默认把日志重定向到临时目录，避免污染真实的 data/memoria.log。
process.env.LOG_PATH = join(mkdtempSync(join(tmpdir(), "memoria-test-log-")), "memoria.log");
