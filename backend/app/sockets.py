from uuid import UUID

from app.storage import load_board, save_board


def is_valid_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


def register_socket_events(sio, room_manager):
    @sio.event
    async def connect(sid, environ, auth=None):
        print(f"Client connected: {sid}")

    @sio.event
    async def join_room(sid, data):
        room_id = data.get("room_id")
        user_name = data.get("user_name", "Anonymous")

        if not room_id:
            await sio.emit(
                "server_error",
                {"message": "room_id is required"},
                room=sid,
            )
            return

        if not is_valid_uuid(room_id):
            await sio.emit(
                "server_error",
                {"message": "room_id must be a valid UUID"},
                room=sid,
            )
            return

        await sio.enter_room(sid, room_id)

        await sio.save_session(
            sid,
            {
                "room_id": room_id,
                "user_name": user_name,
            },
        )

        saved_scene = await load_board(room_id)

        snapshot = await room_manager.join_room(
            sid=sid,
            room_id=room_id,
            user_name=user_name,
            initial_scene=saved_scene,
        )

        users = await room_manager.get_room_users(room_id)

        await sio.emit(
            "room_joined",
            {
                "room_id": room_id,
                "user_id": sid,
                "user_name": user_name,
                "scene": {
                    "elements": snapshot["elements"],
                    "appState": snapshot["appState"],
                },
                "users": users,
            },
            room=sid,
        )

        await sio.emit(
            "user_joined",
            {
                "user_id": sid,
                "user_name": user_name,
            },
            room=room_id,
            skip_sid=sid,
        )

        print(f"{user_name} joined room {room_id}")

    @sio.event
    async def scene_update(sid, data):
        session = await sio.get_session(sid)
        room_id = session.get("room_id")

        if not room_id:
            return

        elements = data.get("elements", [])
        app_state = data.get("appState", {})

        await room_manager.update_scene(room_id, elements, app_state)

        await sio.emit(
            "scene_update",
            {
                "user_id": sid,
                "elements": elements,
                "appState": app_state,
            },
            room=room_id,
            skip_sid=sid,
        )

    @sio.event
    async def pointer_update(sid, data):
        session = await sio.get_session(sid)

        room_id = session.get("room_id")
        user_name = session.get("user_name", "Anonymous")

        if not room_id:
            return

        await sio.emit(
            "pointer_update",
            {
                "user_id": sid,
                "user_name": user_name,
                "pointer": data.get("pointer"),
                "button": data.get("button", "up"),
            },
            room=room_id,
            skip_sid=sid,
        )

    @sio.event
    async def disconnect(sid, reason=None):
        room_id, user_name, is_empty, snapshot = await room_manager.leave_room(sid)

        if room_id and user_name:
            await sio.emit(
                "user_leave",
                {
                    "user_id": sid,
                    "user_name": user_name,
                },
                room=room_id,
            )

            print(f"{user_name} left room {room_id}")

        if is_empty and snapshot:
            await save_board(
                room_id,
                {
                    "elements": snapshot["elements"],
                    "appState": snapshot["appState"],
                },
            )

            print(f"Room {room_id} saved to MinIO and memory cleared.")