import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.sockets import register_socket_events
from app.state import RoomManager


fastapi_app = FastAPI(title="Whiteboard Backend")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)

room_manager = RoomManager()

register_socket_events(sio, room_manager)

app = socketio.ASGIApp(
    socketio_server=sio,
    other_asgi_app=fastapi_app,
    socketio_path="socket.io",
)


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