---
change: chat-markdown-rendering
design-doc: docs/superpowers/specs/2026-06-28-chat-markdown-rendering-design.md
base-ref: 75e3cd5a3ea33fa16f7917c02f01c91e6602e656
---

# Chat Markdown 渲染 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 assistant 消息气泡引入 `react-markdown` v9，使模型返回的 Markdown 符号正确渲染为富文本，user 消息保持纯文本。

**Architecture:** 仅在 `web/src/pages/Chat.tsx` 中修改 assistant 气泡的渲染逻辑，引入 `react-markdown` 及一份模块级 `mdComponents` 常量来覆盖默认样式。user 气泡、后端 API、消息存储均不变。

**Tech Stack:** react-markdown v9（ESM-only）、React 19、Vite 8、Tailwind CSS 3、TypeScript 6

## Global Constraints

- `react-markdown` 版本必须为 `^9`（ESM-only，兼容 `"type":"module"` + Vite）
- 不引入 rehype-highlight、remark-gfm 或 `@tailwindcss/typography`
- user 消息气泡保持 `whitespace-pre-wrap` 纯文本，不渲染 Markdown
- `mdComponents` 必须定义为模块级常量（组件外），避免每次渲染重新创建对象
- 所有命令在 `N:/Data/Projects/memoria/web/` 目录下执行

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `web/src/pages/Chat.tsx` | 修改（第 175 行附近） | 引入 ReactMarkdown、定义 mdComponents、替换 assistant 气泡渲染 |
| `web/package.json` | 修改（dependencies） | 添加 react-markdown ^9 依赖 |

---

### Task 1: 安装 react-markdown 依赖

**Files:**
- Modify: `web/package.json`（dependencies 新增 react-markdown）

**Interfaces:**
- Consumes: 无
- Produces: `react-markdown` 包可在 `web/src/` 中 import，类型定义随包附带

- [x] **步骤 1：在 web/ 目录安装依赖**

```bash
cd N:/Data/Projects/memoria/web && npm install react-markdown@^9
```

预期输出（关键行）：
```
added 1 package
```

`package.json` 的 `dependencies` 新增一行，形如：
```json
"react-markdown": "^9.x.x"
```

- [x] **步骤 2：确认安装成功**

```bash
cd N:/Data/Projects/memoria/web && node -e "import('react-markdown').then(m => console.log('OK', Object.keys(m)))"
```

预期输出：
```
OK [ 'default', ... ]
```

若出现 `ERR_REQUIRE_ESM` 说明运行环境不对，Vite 构建时不会有此问题，可忽略此检查，直接进行步骤 3。

- [x] **步骤 3：提交依赖变更**

```bash
cd N:/Data/Projects/memoria
git add web/package.json web/package-lock.json
git commit -m "chore: 安装 react-markdown v9"
```

---

### Task 2: 在 Chat.tsx 中渲染 assistant 消息 Markdown

**Files:**
- Modify: `web/src/pages/Chat.tsx`（第 1 行 import 区、第 175 行 assistant 气泡）

**Interfaces:**
- Consumes: `react-markdown` 默认导出 `ReactMarkdown`，Task 1 安装的包
- Produces: assistant 消息气泡使用 `<ReactMarkdown components={mdComponents}>` 渲染；user 气泡不变

#### 背景：当前代码结构

`Chat.tsx` 目前在第 175 行渲染 assistant 气泡：

```tsx
<div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
  {m.content}
</div>
```

user 气泡在第 183 行，保持不变：

```tsx
<div className="rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
  {m.content}
</div>
```

- [x] **步骤 1：在文件顶部添加 ReactMarkdown import**

定位 `web/src/pages/Chat.tsx` 第 1 行的 import 块，在最后一条 import 语句之后（第 9 行 `import type { Source } from '@/api'` 之后）添加：

```tsx
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
```

第 1-11 行变为：

```tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Send, Plus, ChevronDown, ChevronUp, MessageSquare, BookOpen, Brain } from 'lucide-react'
import * as api from '@/api'
import type { Source } from '@/api'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
```

- [x] **步骤 2：在 interface DisplayMessage 之前添加 mdComponents 模块级常量**

在第 11 行（`import type { Components }...`）之后、第 12 行（`interface DisplayMessage`）之前插入：

```tsx
const mdComponents: Components = {
  p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  code:   ({ className, children, ...props }) => {
    const isInline = !className
    return isInline
      ? <code className="bg-muted rounded px-1 font-mono text-xs" {...props}>{children}</code>
      : <code className={className} {...props}>{children}</code>
  },
  pre:    ({ children }) => <pre className="bg-muted rounded-xl p-3 overflow-x-auto mb-2 text-xs font-mono">{children}</pre>,
  h1:     ({ children }) => <h1 className="font-semibold text-base mt-3 mb-1">{children}</h1>,
  h2:     ({ children }) => <h2 className="font-semibold text-sm mt-3 mb-1">{children}</h2>,
  h3:     ({ children }) => <h3 className="font-semibold text-sm mt-2 mb-1">{children}</h3>,
  a:      ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
}
```

> 注意：`react-markdown` v9 的 `code` 组件不再接收 `inline` prop，改用有无 `className`（即 `` ` `` 行内码无 className，围栏代码块有 `language-xxx` className）来区分行内/块级。

- [x] **步骤 3：替换 assistant 气泡渲染**

定位第 175 行（assistant 气泡 div），将：

```tsx
<div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
  {m.content}
</div>
```

替换为：

```tsx
<div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm">
  <ReactMarkdown components={mdComponents}>{m.content}</ReactMarkdown>
</div>
```

移除 `whitespace-pre-wrap`（ReactMarkdown 自行处理换行，保留会破坏块级元素间距）。

- [x] **步骤 4：TypeScript 编译检查**

```bash
cd N:/Data/Projects/memoria/web && npx tsc --noEmit
```

预期输出：无任何错误（无输出或仅显示版本信息）。

如果报错 `Property 'inline' does not exist on type`，说明使用了旧版 `inline` prop，请确认步骤 2 中 `code` 组件使用的是 `className` 判断方式。

- [x] **步骤 5：启动开发服务器验证渲染**

```bash
cd N:/Data/Projects/memoria/web && npm run dev
```

打开浏览器访问 `http://localhost:5173`，选择一个机器人，发送以下测试消息并查看 assistant 回复：

```
请用 Markdown 格式回复：包含 **加粗文字**、一个无序列表（至少 2 项）、以及一段 `行内代码` 和代码块：
\`\`\`python
print("hello")
\`\`\`
```

验证要点：
- **加粗** → `<strong>` 渲染为加粗，而非 `**...**` 字面文本
- 无序列表 → 渲染为带圆点的列表，而非 `- ...` 字面文本
- 行内代码 → `bg-muted rounded px-1` 样式的 `<code>` 元素
- 代码块 → `bg-muted rounded-xl p-3` 样式的 `<pre>` 元素
- user 消息的 `**加粗**` 等符号原样显示（不渲染）
- 气泡圆角、间距无回归

- [x] **步骤 6：提交**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/Chat.tsx
git commit -m "feat: assistant 消息气泡引入 react-markdown v9 渲染 Markdown"
```
