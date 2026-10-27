import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Web 端依赖装在 web/node_modules；测试从仓库根目录驱动 React 页面，
// 必须把这些包解析到同一份副本，否则会出现「多份 React」导致 hooks 失效。
const webModules = (name: string) =>
  fileURLToPath(new URL(`./web/node_modules/${name}`, import.meta.url));

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // Web 端与 Node 端共用 `@/` 前缀；测试里同时驱动两侧，统一指向 web/src。
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
      react: webModules("react"),
      "react-dom": webModules("react-dom"),
      "react-router-dom": webModules("react-router-dom"),
      "react-router": webModules("react-router"),
      "@tanstack/react-query": webModules("@tanstack/react-query"),
      "react-markdown": webModules("react-markdown"),
      "remark-gfm": webModules("remark-gfm"),
      "lucide-react": webModules("lucide-react"),
    },
  },
  test: {
    // 统一的重定向配置：测试运行期不写真实 data/memoria.log。
    setupFiles: ["tests-ts/setup.ts"],
  },
});
