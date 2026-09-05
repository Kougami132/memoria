import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from memoria.config import get_effective_settings, get_qq_settings
from memoria.core.embedder import Embedder
from memoria.llm.caller import LLMCaller
from memoria.server.deps import get_db, reset_pipeline
from memoria.storage.db import DB

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


class FetchModelsRequest(BaseModel):
    openai_base_url: Optional[str] = None
    api_key: Optional[str] = None


class SettingsUpdate(BaseModel):
    openai_base_url: Optional[str] = None
    api_key: Optional[str] = None
    external_api_token: Optional[str] = None
    embedding_model: Optional[str] = None
    llm_model: Optional[str] = None
    system_prompt: Optional[str] = None
    top_k: Optional[int] = None
    min_score: Optional[float] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    vault_sync_interval_minutes: Optional[int] = None
    host_dangerous_patterns: Optional[list[str]] = None


class QQSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    app_id: Optional[str] = None
    client_secret: Optional[str] = None
    gateway_intents: Optional[int] = None
    c2c_enabled: Optional[bool] = None
    group_enabled: Optional[bool] = None
    group_require_mention: Optional[bool] = None
    user_allowlist: Optional[list[str]] = None
    group_allowlist: Optional[list[str]] = None
    allow_unlisted_users: Optional[bool] = None
    allow_unlisted_groups: Optional[bool] = None
    group_approval_enabled: Optional[bool] = None
    max_queue_size: Optional[int] = None
    run_timeout_seconds: Optional[int] = None


@router.get("")
def get_settings(db: DB = Depends(get_db)):
    return get_effective_settings(db)


@router.get("/qq")
def get_qq_channel_settings(db: DB = Depends(get_db)):
    result = get_qq_settings(db).copy()
    result["client_secret"] = "********" if result["client_secret"] else ""
    return result


@router.get("/qq/status")
def get_qq_channel_status(request: Request):
    adapter = getattr(request.app.state, "qq_adapter", None)
    if adapter is None:
        return {"status": "disabled", "last_error": None}
    return {"status": adapter.status, "last_error": adapter.last_error}


@router.put("/qq")
async def update_qq_channel_settings(body: QQSettingsUpdate, request: Request, db: DB = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if body.max_queue_size is not None and body.max_queue_size < 1:
        raise HTTPException(status_code=422, detail="max_queue_size must be >= 1")
    if body.run_timeout_seconds is not None and body.run_timeout_seconds < 1:
        raise HTTPException(status_code=422, detail="run_timeout_seconds must be >= 1")
    if body.enabled is True and body.app_id is not None and not body.app_id.strip():
        raise HTTPException(status_code=422, detail="app_id must not be empty")
    if body.client_secret == "********":
        data.pop("client_secret", None)
    for key, value in data.items():
        if isinstance(value, bool):
            value = str(value).lower()
        elif isinstance(value, (list, dict)):
            value = json.dumps(value, ensure_ascii=False)
        db.set_setting(f"qq_{key}", str(value))
    adapter = getattr(request.app.state, "qq_adapter", None)
    if adapter:
        asyncio.create_task(adapter.reload())
    result = get_qq_settings(db).copy()
    result["client_secret"] = "********" if result["client_secret"] else ""
    return result


@router.put("")
def update_settings(body: SettingsUpdate, request: Request, db: DB = Depends(get_db)):
    if body.vault_sync_interval_minutes is not None and body.vault_sync_interval_minutes < 1:
        raise HTTPException(status_code=422, detail="vault_sync_interval_minutes must be >= 1")
    mapping = {
        "openai_base_url": body.openai_base_url,
        "openai_api_key": body.api_key,
        "external_api_token": body.external_api_token,
        "embedding_model": body.embedding_model,
        "llm_model": body.llm_model,
        "system_prompt": body.system_prompt,
        "top_k": str(body.top_k) if body.top_k is not None else None,
        "min_score": str(body.min_score) if body.min_score is not None else None,
        "chunk_size": str(body.chunk_size) if body.chunk_size is not None else None,
        "chunk_overlap": str(body.chunk_overlap) if body.chunk_overlap is not None else None,
        "vault_sync_interval_minutes": str(body.vault_sync_interval_minutes) if body.vault_sync_interval_minutes is not None else None,
        "host_dangerous_patterns": json.dumps(body.host_dangerous_patterns) if body.host_dangerous_patterns is not None else None,
    }
    changed = False
    for key, value in mapping.items():
        if value is None:
            continue
        if value == "" and key != "external_api_token":
            db.delete_setting(key)
        else:
            db.set_setting(key, value)
        changed = True
    if changed:
        reset_pipeline()
    if changed and body.vault_sync_interval_minutes is not None:
        scheduler = getattr(request.app.state, "scheduler", None)
        if scheduler and scheduler.running:
            try:
                minutes = int(db.get_setting("vault_sync_interval_minutes") or 15)
                scheduler.reschedule_job("vault_poll", trigger="interval", minutes=minutes)
            except Exception as exc:
                logger.warning("settings: failed to reschedule vault_poll: %s", exc)
    return get_effective_settings(db)


@router.post("/test-embedding")
def test_embedding(db: DB = Depends(get_db)):
    effective = get_effective_settings(db)
    embedder = Embedder(effective["openai_base_url"], effective["openai_api_key"],
                        effective["embedding_model"])
    try:
        vec = embedder.embed(["test"])
        return {"ok": True, "dimensions": len(vec[0])}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/test-chat")
def test_chat(db: DB = Depends(get_db)):
    import time
    effective = get_effective_settings(db)
    llm = LLMCaller(effective["openai_base_url"], effective["openai_api_key"],
                    effective["llm_model"])
    try:
        t0 = time.monotonic()
        llm.call([{"role": "user", "content": "hi"}])
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        return {"ok": True, "elapsed_ms": elapsed_ms}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/fetch-models")
def fetch_models(body: Optional[FetchModelsRequest] = None, db: DB = Depends(get_db)):
    from openai import OpenAI
    effective = get_effective_settings(db)
    base_url = (body.openai_base_url if body and body.openai_base_url is not None else effective["openai_base_url"]) or ""
    api_key = (body.api_key if body and body.api_key is not None else effective["openai_api_key"]) or ""
    if not base_url:
        raise HTTPException(status_code=422, detail="openai_base_url is required")
    try:
        client = OpenAI(base_url=base_url.rstrip("/"), api_key=api_key or "dummy")
        model_list = client.models.list()
        models = sorted([m.id for m in model_list.data if getattr(m, "id", None)])
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


import os
import io
import json
import zipfile
import shutil
import tempfile
from datetime import datetime, timezone
from fastapi.responses import FileResponse, StreamingResponse
from fastapi import UploadFile, File
from memoria.config import settings

@router.get("/backup/export")
def export_backup(db: DB = Depends(get_db)):
    """Export database, Chroma vector DB, and uploaded files into a zip archive."""
    temp_dir = tempfile.mkdtemp(prefix="memoria_backup_")
    try:
        archive_name = f"memoria_backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
        zip_path = os.path.join(temp_dir, archive_name)

        # 1. Backup SQLite database safely
        db_dump_path = os.path.join(temp_dir, "memoria.db")
        db.backup_to_file(db_dump_path)

        # 2. Package into zip archive
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # Add manifest
            manifest = {
                "version": "1.0",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "app": "memoria",
                "kb_count": len(db.list_kbs()),
                "bot_count": len(db.list_bots()),
            }
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

            # Add database
            if os.path.exists(db_dump_path):
                zf.write(db_dump_path, arcname="db/memoria.db")

            # Add chroma directory if exists
            db_dir = os.path.dirname(os.path.abspath(db._db_path)) if getattr(db, "_db_path", None) and db._db_path != ":memory:" else os.path.abspath("./data")
            chroma_cand = os.path.join(db_dir, "chroma")
            chroma_dir = chroma_cand if os.path.isdir(chroma_cand) else os.path.abspath(settings.chroma_path)
            if os.path.isdir(chroma_dir):
                for root, _, files in os.walk(chroma_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, chroma_dir)
                        zf.write(full_path, arcname=os.path.join("chroma", rel_path).replace("\\", "/"))

            # Add uploads directory if exists
            uploads_cand = os.path.join(db_dir, "uploads")
            upload_dir = uploads_cand if os.path.isdir(uploads_cand) else os.path.abspath(settings.upload_dir)
            if os.path.isdir(upload_dir):
                for root, _, files in os.walk(upload_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, upload_dir)
                        zf.write(full_path, arcname=os.path.join("uploads", rel_path).replace("\\", "/"))

        # Return file response with background task to cleanup temp directory
        from starlette.background import BackgroundTask
        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename=archive_name,
            background=BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


@router.post("/backup/import")
async def import_backup(file: UploadFile = File(...), db: DB = Depends(get_db)):
    """Restore database, Chroma vector DB, and uploaded files from a zip archive."""
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip backup archives are supported")

    content = await file.read()
    temp_dir = tempfile.mkdtemp(prefix="memoria_import_")
    try:
        zip_buf = io.BytesIO(content)
        try:
            with zipfile.ZipFile(zip_buf, "r") as zf:
                zf.extractall(temp_dir)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid zip archive: {e}")

        # Validate structure
        extracted_db = os.path.join(temp_dir, "db", "memoria.db")
        if not os.path.exists(extracted_db):
            raise HTTPException(status_code=400, detail="Archive missing db/memoria.db")

        # 1. Disconnect and reset active pipeline
        reset_pipeline()

        # 2. Restore DB
        db_target_path = getattr(db, "_db_path", None)
        dest_db = os.path.abspath(db_target_path) if db_target_path and db_target_path != ":memory:" else os.path.abspath(settings.db_path)
        os.makedirs(os.path.dirname(dest_db), exist_ok=True)
        # Close current engine/connections if any by disposing
        try:
            db._engine.dispose()
        except Exception:
            pass

        shutil.copy2(extracted_db, dest_db)

        # 3. Restore chroma
        extracted_chroma = os.path.join(temp_dir, "chroma")
        target_dir = os.path.dirname(dest_db)
        dest_chroma = os.path.join(target_dir, "chroma") if target_dir != os.path.abspath("./data") else os.path.abspath(settings.chroma_path)
        if os.path.exists(extracted_chroma):
            if os.path.exists(dest_chroma):
                shutil.rmtree(dest_chroma, ignore_errors=True)
            shutil.copytree(extracted_chroma, dest_chroma, dirs_exist_ok=True)

        # 4. Restore uploads
        extracted_uploads = os.path.join(temp_dir, "uploads")
        dest_uploads = os.path.join(target_dir, "uploads") if target_dir != os.path.abspath("./data") else os.path.abspath(settings.upload_dir)
        if os.path.exists(extracted_uploads):
            if os.path.exists(dest_uploads):
                shutil.rmtree(dest_uploads, ignore_errors=True)
            shutil.copytree(extracted_uploads, dest_uploads, dirs_exist_ok=True)

        # Reset pipeline again with restored data
        reset_pipeline()

        # Return summary of restored knowledge bases
        restored_kbs = db.list_kbs()
        restored_vaults = db.list_vaults()
        return {
            "ok": True,
            "message": "Data restored successfully",
            "kbs_count": len(restored_kbs),
            "vaults_count": len(restored_vaults),
            "vaults": restored_vaults,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
