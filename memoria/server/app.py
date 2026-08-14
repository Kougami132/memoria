import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from memoria.server.routes import agent_chat, agent_sessions, bots, chat, documents, knowledge_bases, settings, sessions, vaults
from memoria.server.deps import get_db, get_pipeline
from memoria.vault.syncer import VaultSyncer


def _sync_all_vaults():
    db = get_db()
    pipeline = get_pipeline()
    syncer = VaultSyncer(db, pipeline)
    for vault in db.list_vaults():
        if not vault.get("auto_sync", True):
            continue
        if vault.get("syncing"):
            continue
        db.set_vault_syncing(vault["id"], True)
        try:
            syncer.sync(vault["id"])
        except Exception:
            logging.getLogger(__name__).exception(
                "vault poll failed: vault_id=%s", vault["id"]
            )
        finally:
            db.set_vault_syncing(vault["id"], False)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from memoria.config import get_effective_settings

    scheduler = AsyncIOScheduler()

    _settings = get_effective_settings(get_db())
    interval_minutes = int(_settings.get("vault_sync_interval_minutes") or 15)

    scheduler.add_job(_sync_all_vaults, "interval", minutes=interval_minutes, max_instances=1, id="vault_poll")
    scheduler.start()
    app.state.scheduler = scheduler
    yield
    scheduler.shutdown(wait=False)


def create_app(lifespan=_lifespan) -> FastAPI:
    app = FastAPI(title="Memoria", lifespan=lifespan)
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(agent_chat.router, prefix="/api")
    app.include_router(agent_sessions.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")
    app.include_router(vaults.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.isdir(static_dir):
        from fastapi.staticfiles import StaticFiles
        from fastapi.responses import FileResponse

        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        index_html = os.path.join(static_dir, "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            candidate = os.path.join(static_dir, full_path)
            if full_path and os.path.isfile(candidate):
                return FileResponse(candidate)
            return FileResponse(index_html)
    else:
        logging.warning("memoria/static/ not found -- Web UI unavailable. Run `npm run build` in web/.")

    return app


app = create_app()
