import { useEffect, useMemo } from "react";
import { throttle } from "./throttle";

export function usePointerSync({ socket, roomId, userName, enabled = true }) {
  const sendPointer = useMemo(() => {
    return throttle((event) => {
      if (!socket || !socket.connected || !roomId || !enabled) return;

      socket.emit("pointer_update", {
        room_id: roomId,
        user_name: userName,
        pointer: {
          x: event.clientX,
          y: event.clientY,
        },
        button: event.buttons > 0 ? "down" : "up",
      });
    }, 50);
  }, [socket, roomId, userName, enabled]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("pointermove", sendPointer);

    return () => {
      window.removeEventListener("pointermove", sendPointer);
    };
  }, [sendPointer, enabled]);
}