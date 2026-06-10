import asyncio
import os
import urllib.parse

import socketio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.auth import get_keycloak_public_config, init_auth_db, router as auth_router
from app.sockets import register_socket_events
from app.state import RoomManager
from app.storage import ensure_bucket, save_board


PUBLIC_APP_URL = os.getenv("PUBLIC_APP_URL", "").strip().rstrip("/")

fastapi_app = FastAPI(title="Whiteboard Backend")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth routes: /auth/register, /auth/login, /auth/me
fastapi_app.include_router(auth_router)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
)

room_manager = RoomManager()

register_socket_events(sio, room_manager)


async def autosave_loop():
    while True:
        await asyncio.sleep(30)

        snapshots = await room_manager.get_dirty_snapshots_and_mark_clean()

        for snapshot in snapshots:
            room_id = snapshot["room_id"]

            await save_board(
                room_id,
                {
                    "elements": snapshot["elements"],
                    "appState": snapshot["appState"],
                },
            )

            print(f"Autosaved room {room_id} to MinIO")


app = socketio.ASGIApp(
    socketio_server=sio,
    other_asgi_app=fastapi_app,
    socketio_path="socket.io",
)


@fastapi_app.on_event("startup")
async def startup():
    init_auth_db()
    await ensure_bucket()
    asyncio.create_task(autosave_loop())


@fastapi_app.get("/")
async def root():
    return {
        "service": "whiteboard-backend",
        "status": "ok",
    }


@fastapi_app.get("/health")
async def health():
    return {
        "status": "healthy",
    }


@fastapi_app.get("/config")
async def config(request: Request):
    keycloak_config = get_keycloak_public_config()
    forwarded_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get(
        "host",
        "",
    )
    public_app_url = (
        PUBLIC_APP_URL
        or (
            f"{forwarded_proto}://{forwarded_host}".rstrip("/")
            if forwarded_host
            else str(request.base_url).rstrip("/")
        )
    )

    if keycloak_config.get("enabled"):
        configured_url = urllib.parse.urlparse(keycloak_config["url"])
        frontend_host = forwarded_host.split(":")[0]

        if frontend_host:
            keycloak_scheme = configured_url.scheme or forwarded_proto
            keycloak_port = configured_url.port or 8080
            keycloak_config = {
                **keycloak_config,
                "url": f"{keycloak_scheme}://{frontend_host}:{keycloak_port}",
            }

    return {
        "publicAppUrl": public_app_url,
        "keycloak": keycloak_config,
    }
