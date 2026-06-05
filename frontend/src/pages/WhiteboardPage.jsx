import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { socket } from "../socket/socket";
import CursorLayer from "../realtime/CursorLayer";
import "./WhiteboardPage.css";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";

const UI_OPTIONS = {
  canvasActions: {
    loadScene: true,
    saveToActiveFile: true,
    saveAsImage: true,
    export: {
      saveFileToDisk: true,
    },
    clearCanvas: true,
    changeViewBackgroundColor: true,
    toggleTheme: true,
  },
  tools: {
    image: true,
  },
};

function getStoredToken() {
  return localStorage.getItem("access_token");
}

function getStoredUsername() {
  return localStorage.getItem("username");
}

function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("username");
  window.location.reload();
}

function SignUpIcon() {
  return (
    <svg
      aria-hidden="true"
      className="whiteboard-signup-icon"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        d="M8 5H5.8A1.8 1.8 0 0 0 4 6.8v10.4A1.8 1.8 0 0 0 5.8 19H8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M10 12h9m0 0-3.5-3.5M19 12l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function throttle(callback, delay) {
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

function getUserName() {
  const params = new URLSearchParams(window.location.search);
  return params.get("name") || `User-${Math.floor(Math.random() * 1000)}`;
}

function isSocketReady() {
  return socket.connected && socket.io?.engine?.readyState === "open";
}

function cleanAppState(appState) {
  return {
    viewBackgroundColor: appState?.viewBackgroundColor || "#ffffff",
  };
}

function isNewerElement(remoteElement, localElement) {
  if (!localElement) return true;

  const remoteVersion = remoteElement.version || 0;
  const localVersion = localElement.version || 0;

  if (remoteVersion > localVersion) return true;
  if (remoteVersion < localVersion) return false;

  return (remoteElement.updated || 0) > (localElement.updated || 0);
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
  const [isJoined, setIsJoined] = useState(false);
  const [cursors, setCursors] = useState({});

  const excalidrawAPIRef = useRef(null);
  const [isApiReady, setIsApiReady] = useState(false);

  const userName = useRef(getStoredUsername() || getUserName());

  const hasJoinedRoom = useRef(false);
  const hasLoadedInitialScene = useRef(false);
  const isApplyingRemoteUpdate = useRef(false);
  const isLocalDrawing = useRef(false);
  const pendingRemoteScene = useRef(null);

  const setExcalidrawAPIOnce = useCallback((api) => {
    if (!api) return;

    if (!excalidrawAPIRef.current) {
      excalidrawAPIRef.current = api;
      setIsApiReady(true);
    }
  }, []);

  const applyRemoteScene = useCallback((data) => {
    const api = excalidrawAPIRef.current;
    if (!api) return;

    const localElements =
      api.getSceneElementsIncludingDeleted?.() || api.getSceneElements();

    const remoteElements = data.elements || [];

    if (localElements.length > 0 && remoteElements.length === 0) {
      console.warn("Ignored empty remote scene update");
      return;
    }

    const mergedElements = mergeElements(localElements, remoteElements);

    isApplyingRemoteUpdate.current = true;

    api.updateScene({
      elements: mergedElements,
      appState: data.appState || {},
    });

    setTimeout(() => {
      isApplyingRemoteUpdate.current = false;
    }, 300);
  }, []);

  const sendSceneUpdate = useMemo(() => {
    return throttle((elements, appState) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;

      socket.emit("scene_update", {
        elements,
        appState: cleanAppState(appState),
      });
    }, 250);
  }, []);

  const sendPointerUpdate = useMemo(() => {
    return throttle((pointer, button) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;

      socket.emit("pointer_update", {
        pointer,
        button: button || "up",
      });
    }, 50);
  }, []);

  useEffect(() => {
    if (!isApiReady) return;

    const api = excalidrawAPIRef.current;
    if (!api) return;

    const handleConnect = () => {
      console.log("Connected:", socket.id);

      socket.emit("join_room", {
        room_id: ROOM_ID,
        user_name: userName.current,
      });
    };

    const handleRoomJoined = (data) => {
      console.log("Room joined:", data);

      hasJoinedRoom.current = true;
      setIsJoined(true);

      const currentApi = excalidrawAPIRef.current;
      if (!currentApi) return;

      const localElements =
        currentApi.getSceneElementsIncludingDeleted?.() ||
        currentApi.getSceneElements();

      const alreadyHasLocalScene = localElements.length > 0;

      if (hasLoadedInitialScene.current || alreadyHasLocalScene) {
        hasLoadedInitialScene.current = true;
        return;
      }

      hasLoadedInitialScene.current = true;
      isApplyingRemoteUpdate.current = true;

      currentApi.updateScene({
        elements: data.scene?.elements || [],
        appState: data.scene?.appState || {},
      });

      setTimeout(() => {
        isApplyingRemoteUpdate.current = false;
      }, 300);
    };

    const handleSceneUpdate = (data) => {
      if (isLocalDrawing.current) {
        pendingRemoteScene.current = data;
        return;
      }

      applyRemoteScene(data);
    };

    const handlePointerUpdate = (data) => {
      if (!data.pointer || !data.user_id) return;

      setCursors((prev) => ({
        ...prev,
        [data.user_id]: {
          user_name: data.user_name,
          pointer: data.pointer,
        },
      }));
    };

    const handleUserLeave = (data) => {
      setCursors((prev) => {
        const copy = { ...prev };
        delete copy[data.user_id];
        return copy;
      });
    };

    const handleServerError = (data) => {
      console.error("Server error:", data);
    };

    const handleDisconnect = () => {
      console.log("Disconnected");
      hasJoinedRoom.current = false;
      setIsJoined(false);
      setCursors({});
    };

    socket.off("connect");
    socket.off("room_joined");
    socket.off("scene_update");
    socket.off("pointer_update");
    socket.off("user_leave");
    socket.off("server_error");
    socket.off("disconnect");

    socket.on("connect", handleConnect);
    socket.on("room_joined", handleRoomJoined);
    socket.on("scene_update", handleSceneUpdate);
    socket.on("pointer_update", handlePointerUpdate);
    socket.on("user_leave", handleUserLeave);
    socket.on("server_error", handleServerError);
    socket.on("disconnect", handleDisconnect);

    if (!socket.connected && socket.disconnected) {
      socket.auth = {
        token: getStoredToken(),
      };

      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("room_joined", handleRoomJoined);
      socket.off("scene_update", handleSceneUpdate);
      socket.off("pointer_update", handlePointerUpdate);
      socket.off("user_leave", handleUserLeave);
      socket.off("server_error", handleServerError);
      socket.off("disconnect", handleDisconnect);

      // Важно: socket.disconnect() здесь НЕ вызываем.
      // Иначе при перерисовке компонента WebSocket закрывается во время рисования.
    };
  }, [isApiReady, applyRemoteScene]);

  const handleChange = useCallback(
    (elements, appState) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;
      if (isApplyingRemoteUpdate.current) return;

      const api = excalidrawAPIRef.current;
      const elementsToSend =
        api?.getSceneElementsIncludingDeleted?.() || elements;

      sendSceneUpdate(elementsToSend, appState);
    },
    [sendSceneUpdate]
  );

  const handlePointerUpdate = useCallback(
    (pointerPayload, buttonArg) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;

      const pointer = pointerPayload?.pointer || pointerPayload;
      const button = pointerPayload?.button || buttonArg || "up";

      if (!pointer) return;

      isLocalDrawing.current = button === "down";

      if (button === "up" && pendingRemoteScene.current) {
        const scene = pendingRemoteScene.current;
        pendingRemoteScene.current = null;

        setTimeout(() => {
          applyRemoteScene(scene);
        }, 100);
      }

      sendPointerUpdate(pointer, button);
    },
    [sendPointerUpdate, applyRemoteScene]
  );

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 72,
          right: 16,
          zIndex: 30,
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

        <button
          type="button"
          onClick={logout}
          style={{
            marginTop: 8,
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      <Excalidraw
        excalidrawAPI={setExcalidrawAPIOnce}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        isCollaborating={true}
        UIOptions={UI_OPTIONS}
        name="Whiteboard"
        libraryReturnUrl={window.location.origin + window.location.pathname}
        langCode="ru-RU"
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.ToggleTheme />

          <MainMenu.ItemLink
            className="whiteboard-signup-menu-item"
            href="/auth"
            icon={<SignUpIcon />}
          >
            Sign up
          </MainMenu.ItemLink>

          <MainMenu.ItemLink href="https://github.com/Madi-afk/whiteboard-project">
            GitHub project
          </MainMenu.ItemLink>

          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      <CursorLayer cursors={cursors} />
    </div>
  );
}