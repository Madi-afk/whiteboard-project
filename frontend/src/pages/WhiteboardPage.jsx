import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { socket } from "../socket/socket";
import CursorLayer from "../realtime/CursorLayer";
import { usePointerSync } from "../realtime/usePointerSync";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";

export default function WhiteboardPage() {
  const [userName, setUserName] = useState("Madi");
  const [isJoined, setIsJoined] = useState(false);
  const [cursors, setCursors] = useState({});
  const [initialData, setInitialData] = useState(null);

  usePointerSync({
    socket,
    roomId: ROOM_ID,
    userName,
    enabled: isJoined,
  });

  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      console.log("Connected:", socket.id);

      socket.emit("join_room", {
        room_id: ROOM_ID,
        user_name: userName,
      });
    });

    socket.on("room_loaded", (data) => {
      console.log("Room loaded:", data);
      setInitialData(data.initialData);
      setIsJoined(true);
    });

    socket.on("pointer_update", (data) => {
      setCursors((prev) => ({
        ...prev,
        [data.user_id]: {
          user_name: data.user_name,
          pointer: data.pointer,
        },
      }));
    });

    socket.on("user_leave", (data) => {
      setCursors((prev) => {
        const copy = { ...prev };
        delete copy[data.user_id];
        return copy;
      });
    });

    return () => {
      socket.off("connect");
      socket.off("room_loaded");
      socket.off("pointer_update");
      socket.off("user_leave");
      socket.disconnect();
    };
  }, [userName]);

  const handleChange = (elements, appState, files) => {
    if (!socket.connected || !isJoined) return;

    socket.emit("scene_update", {
      elements,
      appState,
      files,
    });
  };

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <Excalidraw
        initialData={initialData}
        onChange={handleChange}
      />

      <CursorLayer cursors={cursors} />
    </div>
  );
}