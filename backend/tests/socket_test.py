import asyncio
import socketio


SERVER_URL = "http://localhost:8000"
ROOM_ID = "550e8400-e29b-41d4-a716-446655440000"


async def create_client(user_name: str):
    client = socketio.AsyncClient()

    @client.event
    async def connect():
        print(f"[{user_name}] connected")

    @client.on("room_joined")
    async def on_room_joined(data):
        print(f"[{user_name}] room_joined:", data)

    @client.on("user_joined")
    async def on_user_joined(data):
        print(f"[{user_name}] user_joined:", data)

    @client.on("scene_update")
    async def on_scene_update(data):
        print(f"[{user_name}] scene_update:", data)

    @client.on("pointer_update")
    async def on_pointer_update(data):
        print(f"[{user_name}] pointer_update:", data)

    @client.on("user_leave")
    async def on_user_leave(data):
        print(f"[{user_name}] user_leave:", data)

    await client.connect(
        SERVER_URL,
        socketio_path="socket.io",
        transports=["websocket"],
    )

    await client.emit(
        "join_room",
        {
            "room_id": ROOM_ID,
            "user_name": user_name,
        },
    )

    return client


async def main():
    user_a = await create_client("Blitz_A")
    user_b = await create_client("Blitz_B")

    await asyncio.sleep(1)

    await user_a.emit(
        "pointer_update",
        {
            "pointer": {
                "x": 150,
                "y": 220,
            },
            "button": "up",
        },
    )

    await user_a.emit(
        "scene_update",
        {
            "elements": [
                {
                    "id": "rect-1",
                    "type": "rectangle",
                    "x": 100,
                    "y": 100,
                    "width": 200,
                    "height": 100,
                }
            ],
            "appState": {
                "viewBackgroundColor": "#ffffff",
            },
        },
    )

    await asyncio.sleep(2)

    await user_a.disconnect()
    await user_b.disconnect()


if __name__ == "__main__":
    asyncio.run(main())