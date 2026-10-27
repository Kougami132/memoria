#!/bin/sh
# 本地开发：后端只做 API，前端走 Vite dev server（HMR）。
#
# 注意：不要直接开 http://localhost:8000 —— 它会优先服务 memoria/static 里
# 已有的构建产物（Docker 镜像也是这么来的），所以改了 web/src 却看不到变化。
# 前端页面请走 Vite 的端口，它会把 /api 与 /v1 代理到后端。
set -e
cd "$(dirname "$0")/.."

API_PORT="${PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

echo "API   -> http://localhost:${API_PORT}"
echo "Web   -> http://localhost:${WEB_PORT}   (请在浏览器打开这个)"
echo

PORT="$API_PORT" npx tsx watch src/index.ts &
API_PID=$!

# 让 Vite 的代理指向实际的后端端口（vite.config.ts 默认 8000）
cd web
if [ "$API_PORT" != "8000" ]; then
  echo "注意: vite.config.ts 的代理目标固定为 8000，PORT=${API_PORT} 时 /api 将无法代理。" >&2
fi
npx vite --port "$WEB_PORT" &
WEB_PID=$!

trap 'kill $API_PID $WEB_PID 2>/dev/null' INT TERM EXIT
wait
