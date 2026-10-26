import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 统一的重定向配置：测试运行期不写真实 data/memoria.log。
    setupFiles: ["tests-ts/setup.ts"],
  },
});
