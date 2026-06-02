import asyncio
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RoomState:
    room_id: str
    users: dict[str, str] = field(default_factory=dict)
    elements: list[dict[str, Any]] = field(default_factory=list)
    app_state: dict[str, Any] = field(default_factory=dict)


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, RoomState] = {}
        self.sid_to_room: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def join_room(self, sid: str, room_id: str, user_name: str):
        async with self._lock:
            if room_id not in self.rooms:
                self.rooms[room_id] = RoomState(room_id=room_id)

            room = self.rooms[room_id]
            room.users[sid] = user_name
            self.sid_to_room[sid] = room_id

            return self._snapshot(room)

    async def leave_room(self, sid: str):
        async with self._lock:
            room_id = self.sid_to_room.pop(sid, None)

            if not room_id:
                return None, None, False

            room = self.rooms.get(room_id)

            if not room:
                return room_id, None, False

            user_name = room.users.pop(sid, None)
            is_empty = len(room.users) == 0

            if is_empty:
                self.rooms.pop(room_id, None)

            return room_id, user_name, is_empty

    async def update_scene(self, room_id: str, elements, app_state):
        async with self._lock:
            if room_id not in self.rooms:
                self.rooms[room_id] = RoomState(room_id=room_id)

            room = self.rooms[room_id]
            room.elements = elements
            room.app_state = app_state

            return self._snapshot(room)

    async def get_room_users(self, room_id: str):
        async with self._lock:
            room = self.rooms.get(room_id)

            if not room:
                return []

            return [
                {"user_id": sid, "user_name": user_name}
                for sid, user_name in room.users.items()
            ]

    def _snapshot(self, room: RoomState):
        return {
            "room_id": room.room_id,
            "elements": room.elements,
            "appState": room.app_state,
            "users": [
                {"user_id": sid, "user_name": user_name}
                for sid, user_name in room.users.items()
            ],
        }