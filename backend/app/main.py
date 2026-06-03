import asyncio

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.sockets import register_socket_events
from app.state import RoomManager
from app.storage import ensure_bucket, save_board


fastapi_app = FastAPI(title="Whiteboard Backend")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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