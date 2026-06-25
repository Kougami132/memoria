from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    # 路由注册占位
    return app
