import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { socket } from "../socket/socket";
import CursorLayer from "../realtime/CursorLayer";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";

function throttleTrailing(callback, delay) {
  let lastCall = 0;
  let timer = null;
  let lastArgs = null;

  return (...args) => {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    lastArgs = args;

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      lastCall = now;
      callback(...lastArgs);
      lastArgs = null;
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;

        if (lastArgs) {
          callback(...lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  };
}

function cleanAppState(appState) {
  return {
    viewBackgroundColor: appState?.viewBackgroundColor || "#ffffff",
  };
}

function isNewerElement(nextElement, prevElement) {
  if (!prevElement) return true;

  const nextVersion = nextElement.version || 0;
  const prevVersion = prevElement.version || 0;

  if (nextVersion > prevVersion) return true;
  if (nextVersion < prevVersion) return false;

  return (nextElement.updated || 0) > (prevElement.updated || 0);
}

function mergeElements(localElements, remoteElements) {
  const elementsMap = new Map();

  for (const element of localElements || []) {
    elementsMap.set(element.id, element);
  }

  for (const element of remoteElements || []) {
    const currentElement = elementsMap.get(element.id);

    if (isNewerElement(element, currentElement)) {
      elementsMap.set(element.id, element);
    }
  }

  return Array.from(elementsMap.values());
}

export default function WhiteboardPage() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [isJoined, setIsJoined] = useState(false);
  const [cursors, setCursors] = useState({});

  const isApplyingRemoteUpdate = useRef(false);
  const userName = useRef(`User-${Math.floor(Math.random() * 1000)}`);

  const sendSceneUpdate = useMemo(() => {
    return throttleTrailing((elements, appState) => {
      if (!socket.connected) return;

      socket.emit("scene_update", {
        elements,
        appState: cleanAppState(appState),
      });
    }, 120);
  }, []);

  useEffect(() => {
    if (!excalidrawAPI) return;

    socket.connect();

    socket.on("connect", () => {
      console.log("Connected:", socket.id);

      socket.emit("join_room", {
        room_id: ROOM_ID,
        user_name: userName.current,
      });
    });

    socket.on("room_joined", (data) => {
      console.log("Room joined:", data);

      isApplyingRemoteUpdate.current = true;

      excalidrawAPI.updateScene({
        elements: data.scene?.elements || [],
        appState: data.scene?.appState || {},
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      setIsJoined(true);

      setTimeout(() => {
        isApplyingRemoteUpdate.current = false;
      }, 100);
    });

    socket.on("scene_update", (data) => {
      if (!excalidrawAPI) return;

      const localElements =
        excalidrawAPI.getSceneElementsIncludingDeleted?.() ||
        excalidrawAPI.getSceneElements();

      const mergedElements = mergeElements(localElements, data.elements || []);

      isApplyingRemoteUpdate.current = true;

      excalidrawAPI.updateScene({
        elements: mergedElements,
        appState: data.appState || {},
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      setTimeout(() => {
        isApplyingRemoteUpdate.current = false;
      }, 100);
    });

    socket.on("pointer_update", (data) => {
      if (!data.pointer) return;

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

    socket.on("server_error", (data) => {
      console.error("Server error:", data);
    });

    return () => {
      socket.off("connect");
      socket.off("room_joined");
      socket.off("scene_update");
      socket.off("pointer_update");
      socket.off("user_leave");
      socket.off("server_error");
      socket.disconnect();
    };
  }, [excalidrawAPI]);

  const handleChange = useCallback(
    (elements, appState) => {
      if (!socket.connected) return;
      if (!isJoined) return;
      if (isApplyingRemoteUpdate.current) return;

      sendSceneUpdate(elements, appState);
    },
    [isJoined, sendSceneUpdate]
  );

  const handlePointerUpdate = useCallback(
    (payload) => {
      if (!socket.connected) return;
      if (!isJoined) return;

      socket.emit("pointer_update", {
        pointer: payload.pointer,
        button: payload.button,
      });
    },
    [isJoined]
  );

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          background: "white",
          padding: "8px 12px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          fontSize: 14,
        }}
      >
        <div>Room: {ROOM_ID}</div>
        <div>User: {userName.current}</div>
        <div>Status: {isJoined ? "joined" : "connecting"}</div>
      </div>

      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        isCollaborating={true}
      />

      <CursorLayer cursors={cursors} />
    </div>
  );
}