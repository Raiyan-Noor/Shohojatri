from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.limits import TaskUploadLimit
from app.routers import (
    access,
    admin,
    auth,
    children,
    demo,
    health,
    me,
    meta,
    notifications,
    reports,
    results_chat,
    screenings,
)
from app.schemas.errors import ErrorResponse

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Shohojatri API", version="0.1.0")

    # Added first, so it runs inside CORS and its 411/413 responses still carry CORS headers.
    app.add_middleware(TaskUploadLimit)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Auth uses httpOnly cookies (B2), so the browser must send credentials.
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)

    # Documenting the error shape on every route lets the generated TS client type `error`.
    api = APIRouter(
        prefix=API_PREFIX,
        responses={"default": {"model": ErrorResponse, "description": "Error"}},
    )
    for router in (
        health.router,
        meta.router,
        auth.router,
        me.router,
        admin.router,
        children.router,
        access.router,
        notifications.router,
        screenings.router,
        reports.router,
        results_chat.router,
        demo.router,
    ):
        api.include_router(router)
    app.include_router(api)
    return app


app = create_app()
