import logging
import os

from fastapi import FastAPI

from memoria.server.routes import bots, chat, documents, knowledge_bases, settings, sessions


def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.isdir(static_dir):
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    else:
        logging.warning("memoria/static/ not found -- Web UI unavailable. Run `npm run build` in web/.")

    return app


app = create_app()
