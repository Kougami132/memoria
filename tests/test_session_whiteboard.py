import pytest
from unittest.mock import MagicMock

from memoria.agents.whiteboard import (
    estimate_tokens,
    estimate_history_tokens,
    consolidate_whiteboard,
    build_consolidated_prompt,
)
from memoria.agents.engine import AgentEngine, AgentRunnerOutput


def test_token_estimation():
    assert estimate_tokens("") == 0
    # ASCII text
    ascii_tokens = estimate_tokens("hello world error code 502")
    assert ascii_tokens > 0
    # CJK text should estimate more tokens per char
    cjk_tokens = estimate_tokens("服务器发生严重故障连接超时")
    assert cjk_tokens > 0
    assert cjk_tokens > len("服务器发生严重故障连接超时") * 0.8


def test_whiteboard_consolidation_facts_and_constraints():
    early_msgs = [
        {"role": "user", "content": "我们的主机 10.0.0.5 出现 502 报错，切勿在生产环境重启服务！"},
        {"role": "assistant", "content": "正在检查端口 80 监听情况，发现服务进程挂起。"},
        {"role": "user", "content": "确认该节点为核心网关，只能进行状态查询操作。"},
    ]

    wb = consolidate_whiteboard(early_msgs)
    assert "Session Whiteboard" in wb
    assert "10.0.0.5" in wb or "502" in wb
    assert "切勿在生产环境重启服务" in wb or "只能进行状态查询" in wb


def test_build_consolidated_prompt_below_watermark():
    short_history = [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "您好！有什么我可以协助的吗？"},
    ]
    prompt, wb = build_consolidated_prompt(
        message="请检查主机状态",
        history=short_history,
        watermark_tokens=5000,
        keep_recent_turns=6,
    )
    assert wb == ""
    assert "以下是本会话此前的对话上下文" in prompt
    assert "用户：你好" in prompt
    assert "当前用户问题：请检查主机状态" in prompt


def test_build_consolidated_prompt_above_watermark_20_turns():
    # Simulate 20 turns of incident troubleshooting
    history = []
    for i in range(1, 21):
        history.append({
            "role": "user",
            "content": f"第 {i} 轮故障诊断: 服务器 192.168.1.{i} 出现 ErrCode {10000 + i}，务必切勿重启！",
        })
        history.append({
            "role": "assistant",
            "content": f"第 {i} 轮检查完成，排查了相关网络配置和日志。",
        })

    assert len(history) == 40
    # Watermark set to low value to trigger compression
    prompt, wb = build_consolidated_prompt(
        message="现在给出综合诊断方案",
        history=history,
        watermark_tokens=200,
        keep_recent_turns=6,
    )

    assert wb != ""
    assert "Session Whiteboard" in wb
    assert "近期对话记录 (Recent Turns)" in prompt
    # Recent turns preserved verbatim
    assert "第 20 轮" in prompt
    assert "当前用户问题：现在给出综合诊断方案" in prompt
    # Early constraints preserved in whiteboard
    assert "务必切勿重启" in wb or "切勿" in wb


def test_agent_engine_uses_whiteboard_prompt(tmp_path):
    class RecordingRunner:
        def __init__(self):
            self.last_prompt = None

        def run(self, message, instructions, tools, model_name, session_id=None, tools_schema=None):
            self.last_prompt = message
            return AgentRunnerOutput(answer="已根据白板诊断分析。")

    runner = RecordingRunner()
    mock_db = MagicMock()
    mock_db.list_kbs.return_value = []
    mock_db.list_hosts.return_value = []
    mock_db.get_messages.return_value = [
        {"role": "user", "content": "主机 1.1.1.1 出现 502 严重故障，切勿直接杀死进程！"},
        {"role": "assistant", "content": "已排查端口状态。"},
        {"role": "user", "content": "步骤 2 进行中"},
        {"role": "assistant", "content": "排查结果 2。"},
        {"role": "user", "content": "步骤 3 进行中"},
        {"role": "assistant", "content": "排查结果 3。"},
        {"role": "user", "content": "步骤 4 进行中"},
        {"role": "assistant", "content": "排查结果 4。"},
        {"role": "user", "content": "步骤 5 进行中"},
        {"role": "assistant", "content": "排查结果 5。"},
    ]
    mock_db.create_agentic_session.return_value = {"id": "sess-wb-1"}
    mock_db.add_message.return_value = {"id": "msg-1"}
    mock_db.add_message_trace.return_value = None

    engine = AgentEngine(db=mock_db, pipeline=MagicMock(), runner=runner)
    engine.watermark_tokens = 50  # Lower watermark for test

    res = engine.run("给出总结", session_id="sess-wb-1")
    assert res["answer"] == "已根据白板诊断分析。"
    assert runner.last_prompt is not None
    assert "Session Whiteboard" in runner.last_prompt
    assert "1.1.1.1" in runner.last_prompt or "502" in runner.last_prompt
