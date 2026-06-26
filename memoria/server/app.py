from fastapi import FastAPI

from memoria.server.routes import bots, chat, documents, knowledge_bases


def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
