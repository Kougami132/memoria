import json
import logging
import time
import uuid
from typing import Any, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
try:
    from openai import APIConnectionError, APIError
except ImportError:  # pragma: no cover
    APIConnectionError = ConnectionError
    APIError = RuntimeError
from pydantic import BaseModel, Field

from memoria.agents.engine import AgenticRagEngine
from memoria.server.deps import get_agentic_engine, get_db, require_external_api_token
from memoria.storage.db import DB

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/v1",
    tags=["openai"],
    dependencies=[Depends(require_external_api_token)],
)


# ------------------------------------------------------------------
# Models
# ------------------------------------------------------------------

class ModelObject(BaseModel):
    id: str
    object: str = "model"
    created: int = Field(default_factory=lambda: int(time.time()))
    owned_by: str = "memoria"


class ModelListResponse(BaseModel):
    object: str = "list"
    data: List[ModelObject]


@router.get("/models", response_model=ModelListResponse)
def list_models(db: DB = Depends(get_db)):
    models = [
        ModelObject(id="memoria-agent", owned_by="memoria-system")
    ]
    bots = db.list_bots()
    for bot in bots:
        models.append(ModelObject(id=f"bot:{bot['model_key']}", owned_by="memoria-bot"))
    return ModelListResponse(data=models)


# ------------------------------------------------------------------
# Chat Completions (/v1/chat/completions)
# ------------------------------------------------------------------

class ChatCompletionMessage(BaseModel):
    role: str
    content: Union[str, List[Any]]


class ChatCompletionRequest(BaseModel):
    model: str = "memoria-agent"
    messages: List[ChatCompletionMessage]
    stream: Optional[bool] = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    conversation_id: Optional[str] = None
    session_id: Optional[str] = None


def _resolve_bot(model: str, db: DB) -> Optional[dict]:
    if not model or model in ("memoria-agent", "default", "agent"):
        return None
    bot = db.resolve_bot_model(model)
    if bot is None:
        raise HTTPException(status_code=404, detail=f"Model not found: {model}")
    return bot


def _extract_user_prompt(messages: List[ChatCompletionMessage]) -> str:
    for m in reversed(messages):
        if m.role == "user":
            if isinstance(m.content, str):
                return m.content
            elif isinstance(m.content, list):
                parts = []
                for item in m.content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        parts.append(item.get("text", ""))
                    elif isinstance(item, str):
                        parts.append(item)
                return "\n".join(parts)
    return ""


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // 3)


@router.post("/chat/completions")
def chat_completions(
    body: ChatCompletionRequest,
    request: Request,
    engine: AgenticRagEngine = Depends(get_agentic_engine),
    db: DB = Depends(get_db),
):
    is_web_client = (
        request.headers.get("x-memoria-client") == "web"
        or request.headers.get("x-client") == "web"
        or request.query_params.get("client") == "web"
    )
    start_time = time.time()
    resolved_bot = _resolve_bot(body.model, db)
    bot_id = resolved_bot["id"] if resolved_bot else None
    log_model = resolved_bot["name"] if resolved_bot else body.model
    user_prompt = _extract_user_prompt(body.messages)
    session_id = body.session_id or body.conversation_id
    req_id = f"chatcmpl-{uuid.uuid4().hex[:16]}"
    created_ts = int(start_time)
    prompt_tokens = sum(_estimate_tokens(m.content if isinstance(m.content, str) else str(m.content)) for m in body.messages)

    if not user_prompt.strip():
        raise HTTPException(status_code=400, detail="No user message provided in 'messages'.")

    # Streaming mode
    if body.stream:
        def stream_generator():
            accumulated_text = ""
            status_code = 200
            error_msg = None
            resolved_session_id = session_id

            try:
                first_chunk = {
                    "id": req_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": body.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"role": "assistant", "content": ""},
                            "finish_reason": None,
                        }
                    ],
                }
                yield f"data: {json.dumps(first_chunk, ensure_ascii=False)}\n\n"

                for event in engine.run_stream(
                    message=user_prompt,
                    session_id=session_id,
                    bot_id=bot_id,
                ):
                    event_type = event.get("type")
                    if event_type == "init":
                        resolved_session_id = event.get("session_id")
                    elif event_type == "answer_delta":
                        delta = event.get("delta", "")
                        accumulated_text += delta
                        chunk = {
                            "id": req_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": body.model,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": delta},
                                    "finish_reason": None,
                                }
                            ],
                        }
                        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                    elif event_type == "error":
                        error_msg = event.get("detail", "Error occurred during execution")
                        status_code = 502
                        err_chunk = {
                            "id": req_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": body.model,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": f"\n\n[Error: {error_msg}]"},
                                    "finish_reason": "error",
                                }
                            ],
                        }
                        yield f"data: {json.dumps(err_chunk, ensure_ascii=False)}\n\n"

                if not error_msg:
                    last_chunk = {
                        "id": req_id,
                        "object": "chat.completion.chunk",
                        "created": created_ts,
                        "model": body.model,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {},
                                "finish_reason": "stop",
                            }
                        ],
                    }
                    yield f"data: {json.dumps(last_chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

            except Exception as e:
                status_code = 500
                error_msg = str(e)
                logger.exception("Error in /v1/chat/completions stream: %s", e)
                err_chunk = {
                    "id": req_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": body.model,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": f"\n\n[Error: {error_msg}]"},
                            "finish_reason": "error",
                        }
                    ],
                }
                yield f"data: {json.dumps(err_chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
            finally:
                duration_ms = int((time.time() - start_time) * 1000)
                completion_tokens = _estimate_tokens(accumulated_text)
                total_tokens = prompt_tokens + completion_tokens
                if not is_web_client:
                    try:
                        db.log_api_invocation(
                            endpoint="/v1/chat/completions",
                            method="POST",
                            model=log_model,
                            status_code=status_code,
                            duration_ms=duration_ms,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_tokens=total_tokens,
                            session_id=resolved_session_id,
                            error_msg=error_msg,
                        )
                    except Exception as log_err:
                        logger.error("Failed to log API invocation: %s", log_err)

        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming mode
    try:
        result = engine.run(
            message=user_prompt,
            session_id=session_id,
            bot_id=bot_id,
        )
        answer = result.get("answer", "")
        resolved_session_id = result.get("session_id", session_id)
        completion_tokens = _estimate_tokens(answer)
        total_tokens = prompt_tokens + completion_tokens
        duration_ms = int((time.time() - start_time) * 1000)

        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/chat/completions",
                method="POST",
                model=log_model,
                status_code=200,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                session_id=resolved_session_id,
                error_msg=None,
            )

        return {
            "id": req_id,
            "object": "chat.completion",
            "created": created_ts,
            "model": body.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": answer,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
            "sources": result.get("sources", []),
        }
    except ValueError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/chat/completions",
                method="POST",
                model=log_model,
                status_code=404,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/chat/completions",
                method="POST",
                model=log_model,
                status_code=503,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (APIError, RuntimeError) as e:
        status_code = getattr(e, "status_code", 502)
        if not isinstance(status_code, int) or not (400 <= status_code < 600):
            status_code = 502
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/chat/completions",
                method="POST",
                model=log_model,
                status_code=status_code,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=status_code, detail=f"Model error: {e}")
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/chat/completions",
                method="POST",
                model=log_model,
                status_code=500,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        logger.exception("Error in chat_completions: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------
# Responses API (/v1/responses)
# ------------------------------------------------------------------

class ResponsesRequest(BaseModel):
    model: str = "memoria-agent"
    input: Union[str, List[Any]]
    instructions: Optional[str] = None
    stream: Optional[bool] = False
    conversation_id: Optional[str] = None
    session_id: Optional[str] = None
    tools: Optional[List[Any]] = None


def _extract_response_input(input_val: Union[str, List[Any]]) -> str:
    if isinstance(input_val, str):
        return input_val
    elif isinstance(input_val, list):
        parts = []
        for item in input_val:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if item.get("type") == "message":
                    parts.append(item.get("content", ""))
                elif item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif "content" in item:
                    parts.append(str(item["content"]))
        return "\n".join(parts)
    return str(input_val)


@router.post("/responses")
def create_response(
    body: ResponsesRequest,
    request: Request,
    engine: AgenticRagEngine = Depends(get_agentic_engine),
    db: DB = Depends(get_db),
):
    is_web_client = (
        request.headers.get("x-memoria-client") == "web"
        or request.headers.get("x-client") == "web"
        or request.query_params.get("client") == "web"
    )
    start_time = time.time()
    resolved_bot = _resolve_bot(body.model, db)
    bot_id = resolved_bot["id"] if resolved_bot else None
    log_model = resolved_bot["name"] if resolved_bot else body.model
    user_prompt = _extract_response_input(body.input)
    session_id = body.session_id or body.conversation_id
    response_id = f"resp_{uuid.uuid4().hex[:16]}"
    created_ts = int(start_time)
    prompt_tokens = _estimate_tokens(user_prompt)

    if not user_prompt.strip():
        raise HTTPException(status_code=400, detail="Input text must not be empty.")

    # Streaming mode
    if body.stream:
        def stream_generator():
            accumulated_text = ""
            status_code = 200
            error_msg = None
            resolved_session_id = session_id

            try:
                # 1. response.created event
                init_event = {
                    "type": "response.created",
                    "response": {
                        "id": response_id,
                        "object": "response",
                        "status": "in_progress",
                        "model": body.model,
                        "created_at": created_ts,
                        "conversation_id": session_id,
                    },
                }
                yield f"event: response.created\ndata: {json.dumps(init_event, ensure_ascii=False)}\n\n"

                # 2. Output item message added
                msg_item_id = f"item_msg_{uuid.uuid4().hex[:12]}"
                item_added_event = {
                    "type": "response.output_item.added",
                    "response_id": response_id,
                    "item": {
                        "id": msg_item_id,
                        "type": "message",
                        "role": "assistant",
                        "status": "in_progress",
                        "content": [],
                    },
                }
                yield f"event: response.output_item.added\ndata: {json.dumps(item_added_event, ensure_ascii=False)}\n\n"

                for event in engine.run_stream(
                    message=user_prompt,
                    session_id=session_id,
                    bot_id=bot_id,
                ):
                    event_type = event.get("type")

                    if event_type == "init":
                        resolved_session_id = event.get("session_id")
                        sess_update_event = {
                            "type": "response.session_updated",
                            "session_id": resolved_session_id,
                            "message_id": event.get("message_id"),
                            "user_message_id": event.get("user_message_id"),
                        }
                        yield f"event: response.session_updated\ndata: {json.dumps(sess_update_event, ensure_ascii=False)}\n\n"

                    elif event_type == "thought_delta":
                        thought_event = {
                            "type": "response.thought.delta",
                            "response_id": response_id,
                            "delta": event.get("delta", ""),
                        }
                        yield f"event: response.thought.delta\ndata: {json.dumps(thought_event, ensure_ascii=False)}\n\n"

                    elif event_type == "approval_required":
                        approval_event = {
                            "type": "response.approval_required",
                            "response_id": response_id,
                            "approval_id": event.get("approval_id"),
                            "host_id": event.get("host_id"),
                            "host_name": event.get("host_name"),
                            "command": event.get("command"),
                        }
                        yield f"event: response.approval_required\ndata: {json.dumps(approval_event, ensure_ascii=False)}\n\n"

                    elif event_type == "answer_delta":
                        delta = event.get("delta", "")
                        accumulated_text += delta
                        text_delta_event = {
                            "type": "response.text.delta",
                            "response_id": response_id,
                            "item_id": msg_item_id,
                            "delta": delta,
                        }
                        yield f"event: response.text.delta\ndata: {json.dumps(text_delta_event, ensure_ascii=False)}\n\n"

                    elif event_type == "trace_span":
                        span = dict(event.get("span", {}))
                        phase = event.get("phase", "start")
                        span_item = {
                            "id": span.get("id", f"span_{uuid.uuid4().hex[:8]}"),
                            "trace_id": span.get("trace_id"),
                            "parent_id": span.get("parent_id"),
                            "agent_id": span.get("agent_id"),
                            "agent_name": span.get("agent_name"),
                            "agent_role": span.get("agent_role"),
                            "parent_agent_id": span.get("parent_agent_id"),
                            "type": span.get("type", "tool_call"),
                            "name": span.get("name", ""),
                            "status": "completed" if phase == "end" else "in_progress",
                            "started_at": span.get("started_at"),
                            "ended_at": span.get("ended_at"),
                            "duration_ms": span.get("duration_ms"),
                            "data": span.get("data", {}),
                            "error": span.get("error"),
                         }
                        span_event = {
                            "type": "response.output_item.added" if phase == "start" else "response.output_item.done",
                            "response_id": response_id,
                            "item": span_item,
                            "span": span_item,
                        }
                        yield f"event: response.output_item.{'added' if phase == 'start' else 'done'}\ndata: {json.dumps(span_event, ensure_ascii=False)}\n\n"

                    elif event_type == "tool_start":
                        tool_start_event = {
                            "type": "response.tool.start",
                            "response_id": response_id,
                            "tool_name": event.get("tool_name"),
                            "tool_agent": event.get("tool_agent"),
                            "args": event.get("args"),
                        }
                        yield f"event: response.tool.start\ndata: {json.dumps(tool_start_event, ensure_ascii=False)}\n\n"

                    elif event_type == "tool_end":
                        tool_end_event = {
                            "type": "response.tool.end",
                            "response_id": response_id,
                            "tool_name": event.get("tool_name"),
                            "tool_agent": event.get("tool_agent"),
                            "duration_ms": event.get("duration_ms"),
                            "error": event.get("error"),
                        }
                        yield f"event: response.tool.end\ndata: {json.dumps(tool_end_event, ensure_ascii=False)}\n\n"

                    elif event_type == "sources":
                        sources = event.get("sources", [])
                        if sources:
                            sources_event = {
                                "type": "response.sources",
                                "response_id": response_id,
                                "sources": sources,
                            }
                            yield f"event: response.sources\ndata: {json.dumps(sources_event, ensure_ascii=False)}\n\n"

                    elif event_type == "done":
                        done_trace = event.get("trace")
                        sources = event.get("sources", [])
                        if sources:
                            sources_event = {
                                "type": "response.sources",
                                "response_id": response_id,
                                "sources": sources,
                            }
                            yield f"event: response.sources\ndata: {json.dumps(sources_event, ensure_ascii=False)}\n\n"

                    elif event_type == "error":
                        error_msg = event.get("detail", "Error occurred")
                        status_code = 502
                        err_event = {
                            "type": "response.error",
                            "response_id": response_id,
                            "error": {"message": error_msg},
                        }
                        yield f"event: response.error\ndata: {json.dumps(err_event, ensure_ascii=False)}\n\n"

                # 3. response.output_item.done for text message
                msg_done_event = {
                    "type": "response.output_item.done",
                    "response_id": response_id,
                    "item": {
                        "id": msg_item_id,
                        "type": "message",
                        "role": "assistant",
                        "status": "completed",
                        "content": [{"type": "text", "text": accumulated_text}],
                    },
                }
                yield f"event: response.output_item.done\ndata: {json.dumps(msg_done_event, ensure_ascii=False)}\n\n"

                # 4. response.completed
                completion_tokens = _estimate_tokens(accumulated_text)
                completed_event = {
                    "type": "response.completed",
                    "response": {
                        "id": response_id,
                        "object": "response",
                        "status": "completed" if not error_msg else "failed",
                        "model": body.model,
                        "output": [
                            {
                                "id": f"item_msg_{response_id}",
                                "type": "message",
                                "role": "assistant",
                                "content": [{"type": "text", "text": accumulated_text}],
                            }
                        ],
                        "usage": {
                            "prompt_tokens": prompt_tokens,
                            "completion_tokens": completion_tokens,
                            "total_tokens": prompt_tokens + completion_tokens,
                        },
                        "conversation_id": resolved_session_id,
                        "session_id": resolved_session_id,
                    },
                }
                yield f"event: response.completed\ndata: {json.dumps(completed_event, ensure_ascii=False)}\n\n"

            except Exception as e:
                status_code = 500
                error_msg = str(e)
                logger.exception("Error in /v1/responses stream: %s", e)
                err_event = {
                    "type": "response.error",
                    "response_id": response_id,
                    "error": {"message": error_msg},
                }
                yield f"event: response.error\ndata: {json.dumps(err_event, ensure_ascii=False)}\n\n"
            finally:
                duration_ms = int((time.time() - start_time) * 1000)
                completion_tokens = _estimate_tokens(accumulated_text)
                total_tokens = prompt_tokens + completion_tokens
                if not is_web_client:
                    try:
                        db.log_api_invocation(
                            endpoint="/v1/responses",
                            method="POST",
                            model=log_model,
                            status_code=status_code,
                            duration_ms=duration_ms,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_tokens=total_tokens,
                            session_id=resolved_session_id,
                            error_msg=error_msg,
                        )
                    except Exception as log_err:
                        logger.error("Failed to log API invocation: %s", log_err)

        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming mode
    try:
        result = engine.run(
            message=user_prompt,
            session_id=session_id,
            bot_id=bot_id,
        )
        answer = result.get("answer", "")
        resolved_session_id = result.get("session_id", session_id)
        completion_tokens = _estimate_tokens(answer)
        total_tokens = prompt_tokens + completion_tokens
        duration_ms = int((time.time() - start_time) * 1000)

        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/responses",
                method="POST",
                model=log_model,
                status_code=200,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                session_id=resolved_session_id,
                error_msg=None,
            )

        return {
            "id": response_id,
            "object": "response",
            "status": "completed",
            "model": body.model,
            "created_at": created_ts,
            "conversation_id": resolved_session_id,
            "session_id": resolved_session_id,
            "output": [
                {
                    "id": f"item_msg_{uuid.uuid4().hex[:12]}",
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "text", "text": answer}],
                }
            ],
            "sources": result.get("sources", []),
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            },
        }
    except ValueError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/responses",
                method="POST",
                model=log_model,
                status_code=404,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/responses",
                method="POST",
                model=log_model,
                status_code=503,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (APIError, RuntimeError) as e:
        status_code = getattr(e, "status_code", 502)
        if not isinstance(status_code, int) or not (400 <= status_code < 600):
            status_code = 502
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/responses",
                method="POST",
                model=log_model,
                status_code=status_code,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        raise HTTPException(status_code=status_code, detail=f"Model error: {e}")
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        if not is_web_client:
            db.log_api_invocation(
                endpoint="/v1/responses",
                method="POST",
                model=log_model,
                status_code=500,
                duration_ms=duration_ms,
                prompt_tokens=prompt_tokens,
                session_id=session_id,
                error_msg=str(e),
            )
        logger.exception("Error in create_response: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
