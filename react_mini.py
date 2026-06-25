"""
Phase 0.1 — Mini ReAct Agent
==============================
目标：亲手实现一个最小化的 ReAct 推理-行动-观察 循环
完全不依赖 LangChain/LlamaIndex，只用 OpenAI SDK

运行方式：
  export NEWAPI_KEY="你的key"
  python react_mini.py

需要先安装：
  pip install openai
"""

import json
import os
import sys
import io
import re
from openai import OpenAI

# 暴力强锁 UTF-8，避免中文打印报错
if sys.stdout.encoding and sys.stdout.encoding.upper() != "UTF-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ─── 配置 ──────────────────────────────────────────────
# 你已有的 NewAPI，兼容 OpenAI 的接口
client = OpenAI(
    base_url="https://api.kougami.de/v1",
    api_key=os.environ.get("NEWAPI_KEY", "sk-S51xGBg4SPH7PeZjYidNEfozmu0ezDNHDimc9KrrekvpVnzv"),
)

MODEL = "deepseek-v4-flash"

# ─── 工具定义 ──────────────────────────────────────────
# 每个工具 = name + description + parameters（给 LLM 看的 schema）
# 加上一个 Python 实现（execute 函数）

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "执行数学运算，支持 + - * /",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "数学表达式，如 '2 + 3 * 4'",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "搜索个人知识库中的笔记内容",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词",
                    }
                },
                "required": ["query"],
            },
        },
    },
]


def execute_tool(name: str, args: dict) -> str:
    """实际执行工具调用"""
    if name == "calculator":
        expr = args["expression"]
        # 安全求值：只允许数字和运算符
        safe = re.sub(r"[^0-9+\-*/.() ]", "", expr)
        try:
            return str(eval(safe))
        except Exception as e:
            return f"计算错误：{e}"

    if name == "search_knowledge":
        # 这是给 LLM 用的"假"搜索——实际会替换成向量检索
        # 现在先返回固定数据，让你感受 agent 工作流
        db = {
            "jellyfin 转码": "Jellyfin 支持 QSV、NVENC、VAAPI 三种硬件转码方案。QSV 对 Intel 核显效果好，NVENC 适合 N 卡，VAAPI 通用性最强。",
            "transformer 架构": "Transformer 由 Encoder 和 Decoder 组成，核心是 Self-Attention 机制。2017 年由 Google 提出，是 GPT/BERT 的基础。",
            "RAG 是什么": "RAG = Retrieval-Augmented Generation，检索增强生成。先检索相关文档，再让 LLM 基于检索结果生成答案，减少幻觉。",
        }
        # 简单关键词匹配，模拟搜索
        q = args["query"].lower()
        for key, val in db.items():
            if q in key or q in key.replace(" ", ""):
                return val
        return f"未找到与「{args['query']}」相关的内容"

    return f"未知工具：{name}"


# ─── ReAct 循环 ────────────────────────────────────────
# 核心就是三步循环：
#   1. Thought — LLM 推理当前状态，决定下一步
#   2. Action — 调用工具，拿到观察结果
#   3. Observation — 把结果放回上下文，继续思考
#   直到 LLM 给出最终答案（没有 tool_calls）

SYSTEM_PROMPT = """你是一个知识助手，通过工具来回答问题。
你有两个工具可用：
- calculator：做数学计算
- search_knowledge：搜索知识库

工作方式：
1. 首先思考（Thought）当前情况
2. 如果需要信息或计算，调用工具（Action）
3. 根据工具返回的结果（Observation）继续思考
4. 当信息足够时，给出最终答案

不要猜测答案，不确定就去搜索。"""


def run_agent(query: str, max_turns: int = 10) -> str:
    """运行 ReAct 循环，返回最终答案"""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": query},
    ]

    for turn in range(max_turns):
        print(f"\n{'─'*50}")
        print(f"🔄 Turn {turn + 1}")

        # Step 1: 调用 LLM
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
        )

        message = response.choices[0].message
        messages.append(message)

        # Step 2: 检查 LLM 是否想调用工具
        if message.tool_calls:
            for tc in message.tool_calls:
                function_name = tc.function.name
                function_args = json.loads(tc.function.arguments)

                print(f"🤖 Thought: {message.content or '(无显式思考，直接行动)'}")
                print(f"🔧 Action: {function_name}({function_args})")

                # 执行工具
                result = execute_tool(function_name, function_args)
                print(f"📊 Observation: {result[:100]}..." if len(result) > 100 else f"📊 Observation: {result}")

                # 把工具结果放回对话
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })
        else:
            # LLM 没有调用工具 → 这就是最终答案
            print(f"🤖 Thought: {message.content or '(最终回答)'}")
            return message.content

    return "已达最大循环次数，未得到最终答案。"


# ─── 启动 ──────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("🧪 Mini ReAct Agent Demo")
    print("输入问题，Agent 会调用工具来回答")
    print("输入 q 退出")
    print("=" * 50)

    while True:
        query = input("\n❓ 你的问题：").strip()
        if query.lower() in ("q", "quit", "exit"):
            break
        if not query:
            continue

        answer = run_agent(query)
        print(f"\n{'='*50}")
        print(f"✅ 最终答案：{answer}")
