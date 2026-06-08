import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { throttle } from "../realtime/throttle";
import { socket } from "../socket/socket";
import CursorLayer from "../realtime/CursorLayer";
import "./WhiteboardPage.css";

const ROOM_QUERY_PARAM = "room";

const USER_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#ea580c",
];

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

function isValidRoomId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value || ""
  );
}

function createRoomId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const getRandomByte = () => {
    if (window.crypto?.getRandomValues) {
      return window.crypto.getRandomValues(new Uint8Array(1))[0];
    }

    return Math.floor(Math.random() * 256);
  };

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (
      Number(char) ^
      (getRandomByte() & (15 >> (Number(char) / 4)))
    ).toString(16)
  );
}

function getRoomIdFromUrl() {
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get(ROOM_QUERY_PARAM);

  if (isValidRoomId(roomId)) {
    return roomId;
  }

  const nextRoomId = createRoomId();
  url.searchParams.set(ROOM_QUERY_PARAM, nextRoomId);
  window.history.replaceState({}, "", url.toString());

  return nextRoomId;
}

function getRoomUrl(roomId, shareOrigin = window.location.origin) {
  const url = new URL(window.location.href);
  const publicUrl = new URL(shareOrigin);

  url.protocol = publicUrl.protocol;
  url.host = publicUrl.host;
  url.pathname = "/";
  url.searchParams.set(ROOM_QUERY_PARAM, roomId);

  return url.toString();
}

async function getShareOrigin() {
  try {
    const response = await fetch("/api/config");

    if (!response.ok) {
      return window.location.origin;
    }

    const data = await response.json();
    return data.publicAppUrl || window.location.origin;
  } catch {
    return window.location.origin;
  }
}

function getUserName() {
  const params = new URLSearchParams(window.location.search);
  return params.get("name") || `User-${Math.floor(Math.random() * 1000)}`;
}

function getUserColor(userId) {
  let hash = 0;

  for (const char of userId || "") {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return USER_COLORS[hash % USER_COLORS.length];
}

function getInitials(name) {
  return (name || "U").trim().slice(0, 2).toUpperCase();
}

function isSocketReady() {
  return socket.connected && socket.io?.engine?.readyState === "open";
}

function cleanAppState(appState) {
  return {
    viewBackgroundColor: appState?.viewBackgroundColor || "#ffffff",
    theme: appState?.theme || "light",
    gridSize: appState?.gridSize || null,
  };
}

function isNewerElement(remoteElement, localElement) {
  if (!localElement) return true;

  const remoteVersion = remoteElement.version || 0;
  const localVersion = localElement.version || 0;
  const remoteIsDeleted = Boolean(remoteElement.isDeleted);
  const localIsDeleted = Boolean(localElement.isDeleted);

  if (remoteIsDeleted && !localIsDeleted && remoteVersion >= localVersion) {
    return true;
  }

  if (!remoteIsDeleted && localIsDeleted && remoteVersion <= localVersion) {
    return false;
  }

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

function getElementRevision(element) {
  return [
    element.version || 0,
    element.versionNonce || 0,
    element.updated || 0,
    element.isDeleted ? 1 : 0,
  ].join(":");
}

function getChangedElements(elements, sentRevisions) {
  return (elements || []).filter((element) => {
    if (!element?.id) return false;

    return sentRevisions.get(element.id) !== getElementRevision(element);
  });
}

function getViewportState(appState) {
  return {
    zoom: { value: appState?.zoom?.value || 1 },
    scrollX: appState?.scrollX || 0,
    scrollY: appState?.scrollY || 0,
    offsetLeft: appState?.offsetLeft || 0,
    offsetTop: appState?.offsetTop || 0,
  };
}

function areViewportStatesEqual(a, b) {
  if (!a || !b) return a === b;

  return (
    (a.zoom?.value || 1) === (b.zoom?.value || 1) &&
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.offsetLeft === b.offsetLeft &&
    a.offsetTop === b.offsetTop
  );
}

function scenePointerToViewportPointer(pointer, viewportState) {
  if (!pointer || !viewportState) return pointer;

  const viewportPointer = sceneCoordsToViewportCoords(
    {
      sceneX: pointer.x,
      sceneY: pointer.y,
    },
    viewportState
  );

  return {
    ...pointer,
    x: viewportPointer.x,
    y: viewportPointer.y,
  };
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

export default function WhiteboardPage() {
  const [isJoined, setIsJoined] = useState(false);
  const [connectionLabel, setConnectionLabel] = useState("connecting");
  const [users, setUsers] = useState([]);
  const [cursors, setCursors] = useState({});
  const [viewportState, setViewportState] = useState(null);
  const [shareLabel, setShareLabel] = useState("Copy link");
  const [libraryLabel, setLibraryLabel] = useState("Open library");

  const excalidrawAPIRef = useRef(null);
  const libraryInputRef = useRef(null);
  const [isApiReady, setIsApiReady] = useState(false);

  const roomId = useRef(getRoomIdFromUrl());
  const userName = useRef(getStoredUsername() || getUserName());

  const hasJoinedRoom = useRef(false);
  const hasLoadedInitialScene = useRef(false);
  const isApplyingRemoteUpdate = useRef(false);
  const sentElementRevisions = useRef(new Map());
  const lastSentAppState = useRef("");

  const usersWithColors = useMemo(() => {
    return users.map((user) => ({
      ...user,
      color: getUserColor(user.user_id),
    }));
  }, [users]);

  const viewportCursors = useMemo(() => {
    const next = {};

    for (const [userId, cursor] of Object.entries(cursors)) {
      next[userId] = {
        ...cursor,
        pointer: scenePointerToViewportPointer(cursor.pointer, viewportState),
      };
    }

    return next;
  }, [cursors, viewportState]);

  const setExcalidrawAPIOnce = useCallback((api) => {
    if (!api) return;

    if (!excalidrawAPIRef.current) {
      excalidrawAPIRef.current = api;
      setViewportState(getViewportState(api.getAppState?.()));
      setIsApiReady(true);
    }
  }, []);

  const setRoomUsers = useCallback((nextUsers) => {
    setUsers(Array.isArray(nextUsers) ? nextUsers : []);
  }, []);

  const updateViewportState = useCallback((appState) => {
    if (!appState) return;

    const nextViewportState = getViewportState(appState);
    setViewportState((currentViewportState) => {
      if (areViewportStatesEqual(currentViewportState, nextViewportState)) {
        return currentViewportState;
      }

      return nextViewportState;
    });
  }, []);

  const updateRemoteCursor = useCallback((data, { keepPosition = false } = {}) => {
    if (!data?.user_id || data.user_id === socket.id) return;

    setCursors((prev) => {
      const current = prev[data.user_id];
      const pointer = data.pointer || current?.pointer;

      if (!pointer && keepPosition) {
        return prev;
      }

      if (!pointer) {
        return prev;
      }

      return {
        ...prev,
        [data.user_id]: {
          user_name: data.user_name || current?.user_name || "User",
          pointer,
          color: current?.color || getUserColor(data.user_id),
          lastSeen: Date.now(),
        },
      };
    });
  }, []);

  const applyRemoteScene = useCallback((data) => {
    const api = excalidrawAPIRef.current;
    if (!api) return;

    const localElements =
      api.getSceneElementsIncludingDeleted?.() || api.getSceneElements();

    const mergedElements = mergeElements(localElements, data.elements || []);

    isApplyingRemoteUpdate.current = true;

    api.updateScene({
      elements: mergedElements,
      appState: data.appState || {},
    });

    updateViewportState(api.getAppState?.());

    for (const element of data.elements || []) {
      if (element?.id) {
        sentElementRevisions.current.set(
          element.id,
          getElementRevision(element)
        );
      }
    }

    lastSentAppState.current = JSON.stringify(
      cleanAppState(data.appState || {})
    );

    window.setTimeout(() => {
      isApplyingRemoteUpdate.current = false;
    }, 80);
  }, [updateViewportState]);

  const sendSceneUpdate = useMemo(() => {
    return throttle((elements, appState) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;

      const nextAppState = cleanAppState(appState);

      socket.emit("scene_update", {
        elements,
        appState: nextAppState,
      });

      for (const element of elements || []) {
        if (element?.id) {
          sentElementRevisions.current.set(
            element.id,
            getElementRevision(element)
          );
        }
      }

      lastSentAppState.current = JSON.stringify(nextAppState);
    }, 70);
  }, []);

  const sendPointerUpdate = useMemo(() => {
    return throttle((pointer, button) => {
      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;

      socket.emit("pointer_update", {
        pointer,
        button: button || "up",
      });
    }, 25);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();

      setCursors((prev) => {
        const next = {};

        for (const [userId, cursor] of Object.entries(prev)) {
          if (now - cursor.lastSeen < 30000) {
            next[userId] = cursor;
          }
        }

        return next;
      });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!isApiReady) return;

    const joinRoom = () => {
      setConnectionLabel("joining");

      socket.emit("join_room", {
        room_id: roomId.current,
        user_name: userName.current,
      });
    };

    const handleConnect = () => {
      setConnectionLabel("connected");
      joinRoom();
    };

    const handleRoomJoined = (data) => {
      hasJoinedRoom.current = true;
      setIsJoined(true);
      setConnectionLabel("live");
      setRoomUsers(data.users);

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

      const initialElements = data.scene?.elements || [];

      for (const element of initialElements) {
        if (element?.id) {
          sentElementRevisions.current.set(
            element.id,
            getElementRevision(element)
          );
        }
      }

      lastSentAppState.current = JSON.stringify(
        cleanAppState(data.scene?.appState || {})
      );

      window.setTimeout(() => {
        isApplyingRemoteUpdate.current = false;
      }, 80);
    };

    const handleSceneUpdate = (data) => {
      if (data.user_id === socket.id) return;

      applyRemoteScene(data);
      updateRemoteCursor(data, { keepPosition: true });
    };

    const handlePointerUpdate = (data) => {
      updateRemoteCursor(data);
    };

    const handleUsersUpdate = (data) => {
      setRoomUsers(data.users);
    };

    const handleUserLeave = (data) => {
      if (data.users) {
        setRoomUsers(data.users);
      }

      setCursors((prev) => {
        const copy = { ...prev };
        delete copy[data.user_id];
        return copy;
      });
    };

    const handleServerError = (data) => {
      setConnectionLabel("error");
      console.error("Server error:", data);
    };

    const handleDisconnect = () => {
      hasJoinedRoom.current = false;
      setIsJoined(false);
      setConnectionLabel("offline");
      setUsers([]);
      setCursors({});
    };

    socket.off("connect");
    socket.off("room_joined");
    socket.off("scene_update");
    socket.off("pointer_update");
    socket.off("users_update");
    socket.off("user_joined");
    socket.off("user_leave");
    socket.off("server_error");
    socket.off("disconnect");

    socket.on("connect", handleConnect);
    socket.on("room_joined", handleRoomJoined);
    socket.on("scene_update", handleSceneUpdate);
    socket.on("pointer_update", handlePointerUpdate);
    socket.on("users_update", handleUsersUpdate);
    socket.on("user_joined", handleUsersUpdate);
    socket.on("user_leave", handleUserLeave);
    socket.on("server_error", handleServerError);
    socket.on("disconnect", handleDisconnect);

    socket.auth = {
      token: getStoredToken(),
    };

    if (socket.connected) {
      joinRoom();
    } else if (socket.disconnected) {
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("room_joined", handleRoomJoined);
      socket.off("scene_update", handleSceneUpdate);
      socket.off("pointer_update", handlePointerUpdate);
      socket.off("users_update", handleUsersUpdate);
      socket.off("user_joined", handleUsersUpdate);
      socket.off("user_leave", handleUserLeave);
      socket.off("server_error", handleServerError);
      socket.off("disconnect", handleDisconnect);
    };
  }, [isApiReady, applyRemoteScene, setRoomUsers, updateRemoteCursor]);

  const handleChange = useCallback(
    (elements, appState) => {
      updateViewportState(appState);

      if (!isSocketReady()) return;
      if (!hasJoinedRoom.current) return;
      if (isApplyingRemoteUpdate.current) return;

      const api = excalidrawAPIRef.current;
      const elementsToSend =
        api?.getSceneElementsIncludingDeleted?.() || elements;
      const changedElements = getChangedElements(
        elementsToSend,
        sentElementRevisions.current
      );
      const appStateKey = JSON.stringify(cleanAppState(appState));

      if (
        changedElements.length === 0 &&
        appStateKey === lastSentAppState.current
      ) {
        return;
      }

      sendSceneUpdate(changedElements, appState);
    },
    [sendSceneUpdate, updateViewportState]
  );

  const handlePointerUpdate = useCallback(
    (data) => {
      if (!data?.pointer) return;
      sendPointerUpdate(data.pointer, data.button);
    },
    [sendPointerUpdate]
  );

  const handleScrollChange = useCallback((scrollX, scrollY, zoom) => {
    const appState = excalidrawAPIRef.current?.getAppState?.();

    updateViewportState({
      zoom,
      scrollX,
      scrollY,
      offsetLeft: appState?.offsetLeft || 0,
      offsetTop: appState?.offsetTop || 0,
    });
  }, [updateViewportState]);

  const copyRoomLink = useCallback(async () => {
    setShareLabel("Copying");

    const shareOrigin = await getShareOrigin();
    const url = getRoomUrl(roomId.current, shareOrigin);

    try {
      await navigator.clipboard.writeText(url);
      setShareLabel("Copied");
    } catch {
      window.prompt("Copy room link", url);
      setShareLabel("Copy link");
      return;
    }

    window.setTimeout(() => setShareLabel("Copy link"), 1500);
  }, []);

  const openLibraryFilePicker = useCallback(() => {
    libraryInputRef.current?.click();
  }, []);

  const handleLibraryFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    const api = excalidrawAPIRef.current;

    if (!api) {
      setLibraryLabel("Not ready");
      window.setTimeout(() => setLibraryLabel("Open library"), 1500);
      return;
    }

    setLibraryLabel("Opening");

    try {
      await api.updateLibrary({
        libraryItems: file,
        merge: true,
        openLibraryMenu: true,
        prompt: true,
      });

      setLibraryLabel("Opened");
      window.setTimeout(() => setLibraryLabel("Open library"), 1500);
    } catch (error) {
      console.error("Failed to open library:", error);
      setLibraryLabel("Failed");
      window.setTimeout(() => setLibraryLabel("Open library"), 1800);
    }
  }, []);

  return (
    <div className="whiteboard-page">
      <div className="collab-toolbar">
        <div className={`live-dot ${isJoined ? "is-live" : ""}`} />

        <div className="collab-room">
          <span>Room</span>
          <strong>{roomId.current.slice(0, 8)}</strong>
        </div>

        <div className="collab-users" aria-label="Online collaborators">
          {usersWithColors.slice(0, 5).map((user) => (
            <div
              className="collab-avatar"
              key={user.user_id}
              style={{ "--user-color": user.color }}
              title={user.user_name}
            >
              {getInitials(user.user_name)}
            </div>
          ))}
        </div>

        <div className="collab-status">
          {usersWithColors.length} online / {connectionLabel}
        </div>

        <button className="collab-button" type="button" onClick={copyRoomLink}>
          {shareLabel}
        </button>

        <input
          ref={libraryInputRef}
          type="file"
          accept=".excalidrawlib,application/json"
          className="whiteboard-hidden-input"
          onChange={handleLibraryFileChange}
        />

        <button
          className="collab-button"
          type="button"
          onClick={openLibraryFilePicker}
        >
          {libraryLabel}
        </button>

        <button className="collab-button" type="button" onClick={logout}>
          Logout
        </button>
      </div>

      <Excalidraw
        excalidrawAPI={setExcalidrawAPIOnce}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
        onScrollChange={handleScrollChange}
        isCollaborating={true}
        UIOptions={UI_OPTIONS}
        name={userName.current}
        libraryReturnUrl={getRoomUrl(roomId.current)}
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

      <CursorLayer cursors={viewportCursors} />
    </div>
  );
}
