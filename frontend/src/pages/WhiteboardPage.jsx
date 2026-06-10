import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Excalidraw,
  MainMenu,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { throttle } from "../realtime/throttle";
import { socket } from "../socket/socket";
import CursorLayer from "../realtime/CursorLayer";
import {
  EXCALIDRAW_LIBRARY_BASE_URL,
  EXCALIDRAW_TOP_LIBRARIES,
} from "./excalidrawTopLibraries";
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

const LASER_TRAIL_MAX_POINTS = 22;
const AUTH_PROVIDER_KEY = "auth_provider";
const KEYCLOAK_ID_TOKEN_KEY = "keycloak_id_token";
const EXCALIDRAW_LIBRARY_MIME_TYPE = "application/vnd.excalidrawlib+json";
const CONFIG_TIMEOUT_MS = 5000;
const AUTH_CALLBACK_PARAMS = [
  "code",
  "error",
  "error_description",
  "iss",
  "session_state",
  "state",
];

function getStoredToken() {
  return localStorage.getItem("access_token");
}

function getStoredUsername() {
  return localStorage.getItem("username");
}

function clearAuthStorage() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("username");
  localStorage.removeItem(AUTH_PROVIDER_KEY);
  localStorage.removeItem(KEYCLOAK_ID_TOKEN_KEY);
}

async function getAppConfig() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, CONFIG_TIMEOUT_MS);

  let response;

  try {
    response = await fetch("/api/config", {
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error("Failed to load app config");
  }

  return response.json();
}

async function logout() {
  const provider = localStorage.getItem(AUTH_PROVIDER_KEY);
  const idToken = localStorage.getItem(KEYCLOAK_ID_TOKEN_KEY);

  clearAuthStorage();
  socket.disconnect();

  if (provider === "keycloak") {
    try {
      const config = await getAppConfig();
      const keycloak = config.keycloak;

      if (keycloak?.enabled) {
        const logoutUrl = new URL(
          `${keycloak.url}/realms/${keycloak.realm}/protocol/openid-connect/logout`
        );

        logoutUrl.searchParams.set("client_id", keycloak.clientId);
        logoutUrl.searchParams.set(
          "post_logout_redirect_uri",
          `${window.location.origin}/auth`
        );

        if (idToken) {
          logoutUrl.searchParams.set("id_token_hint", idToken);
        }

        window.location.assign(logoutUrl.toString());
        return;
      }
    } catch (error) {
      console.error("Failed to start Keycloak logout:", error);
    }
  }

  window.location.assign("/auth");
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

  for (const param of AUTH_CALLBACK_PARAMS) {
    url.searchParams.delete(param);
  }

  if (isValidRoomId(roomId)) {
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, "", url.toString());
    }

    return roomId;
  }

  const nextRoomId = createRoomId();
  url.searchParams.set(ROOM_QUERY_PARAM, nextRoomId);

  window.history.replaceState({}, "", url.toString());

  return nextRoomId;
}

function getRoomUrl(roomId, shareOrigin = window.location.origin) {
  const url = new URL("/", shareOrigin);
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

function formatDownloads(value) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
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
  const [libraryHost, setLibraryHost] = useState(null);
  const [activeTopLibrary, setActiveTopLibrary] = useState(null);
  const [addedTopLibrary, setAddedTopLibrary] = useState(null);
  const [failedTopLibrary, setFailedTopLibrary] = useState(null);
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [isUsersListOpen, setIsUsersListOpen] = useState(false);

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
        trail: (cursor.trail || []).map((point) =>
          scenePointerToViewportPointer(point, viewportState)
        ),
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
          button: data.button || current?.button || "up",
          color: current?.color || getUserColor(data.user_id),
          lastSeen: Date.now(),
          trail:
            pointer.tool === "laser"
              ? [
                  ...(current?.trail || []),
                  {
                    x: pointer.x,
                    y: pointer.y,
                  },
                ].slice(-LASER_TRAIL_MAX_POINTS)
              : [],
        },
      };
    });
  }, []);

  useEffect(() => {
    const syncLibraryHost = () => {
      setLibraryHost(document.querySelector(".layer-ui__library"));
    };

    syncLibraryHost();

    const observer = new MutationObserver(syncLibraryHost);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
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

  const addTopLibrary = useCallback(async (library) => {
    const api = excalidrawAPIRef.current;

    if (!api) return;

    const libraryUrl = `${EXCALIDRAW_LIBRARY_BASE_URL}/${library.source}`;

    setActiveTopLibrary(library.source);
    setAddedTopLibrary(null);
    setFailedTopLibrary(null);

    try {
      const response = await fetch(libraryUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch library: ${response.status}`);
      }

      const blob = await response.blob();
      const fileName = library.source.split("/").pop() || "library.excalidrawlib";
      const file = new File([blob], fileName, {
        type: EXCALIDRAW_LIBRARY_MIME_TYPE,
      });

      await api.updateLibrary({
        libraryItems: file,
        merge: true,
        openLibraryMenu: true,
        prompt: false,
      });

      setAddedTopLibrary(library.source);
      window.setTimeout(() => setAddedTopLibrary(null), 1800);
    } catch (error) {
      console.error("Failed to add Excalidraw library:", error);
      setFailedTopLibrary(library.source);
      window.setTimeout(() => setFailedTopLibrary(null), 2200);
    } finally {
      setActiveTopLibrary(null);
    }
  }, []);

  const toggleToolbar = useCallback(() => {
    setIsToolbarCollapsed((value) => !value);
    setIsUsersListOpen(false);
  }, []);

  const toggleUsersList = useCallback(() => {
    setIsUsersListOpen((value) => !value);
  }, []);

  return (
    <div className="whiteboard-page">
      <div
        className={`collab-toolbar ${
          isToolbarCollapsed ? "is-collapsed" : ""
        }`}
      >
        <button
          aria-label={isToolbarCollapsed ? "Show toolbar" : "Hide toolbar"}
          className="collab-toggle"
          type="button"
          onClick={toggleToolbar}
        >
          <span className="collab-toggle-icon" aria-hidden="true" />
        </button>

        <div className="collab-content">
          <div className="collab-room-group">
            <div className={`live-dot ${isJoined ? "is-live" : ""}`} />

            <div className="collab-room">
              <span>Room</span>
              <strong>{roomId.current.slice(0, 8)}</strong>
            </div>
          </div>

          <div className="collab-users-wrap">
            <button
              aria-expanded={isUsersListOpen}
              aria-label="Show room users"
              className="collab-users-button"
              type="button"
              onClick={toggleUsersList}
            >
              <span className="collab-users" aria-hidden="true">
                {usersWithColors.slice(0, 5).map((user) => (
                  <span
                    className="collab-avatar"
                    key={user.user_id}
                    style={{ "--user-color": user.color }}
                    title={user.user_name}
                  >
                    {getInitials(user.user_name)}
                  </span>
                ))}
              </span>
              <span className="collab-users-meta">
                <span className="collab-users-label">Users</span>
                <strong>{usersWithColors.length}</strong>
              </span>
            </button>

            {isUsersListOpen && (
              <div className="collab-users-popover">
                <div className="collab-users-popover-title">
                  <span>Users in room</span>
                  <strong>{usersWithColors.length}</strong>
                </div>

                <div className="collab-users-list">
                  {usersWithColors.map((user) => (
                    <div className="collab-user-row" key={user.user_id}>
                      <span
                        className="collab-user-avatar"
                        style={{ "--user-color": user.color }}
                      >
                        {getInitials(user.user_name)}
                      </span>
                      <span className="collab-user-name">
                        {user.user_name}
                        {user.user_id === socket.id ? " (you)" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="collab-status">
            {usersWithColors.length} online / {connectionLabel}
          </div>

          <button className="collab-button" type="button" onClick={copyRoomLink}>
            {shareLabel}
          </button>

          <button className="collab-button" type="button" onClick={logout}>
            Logout
          </button>
        </div>
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

      {libraryHost &&
        createPortal(
          <div className="whiteboard-library-actions">
            <input
              ref={libraryInputRef}
              type="file"
              accept=".excalidrawlib,application/json"
              className="whiteboard-hidden-input"
              onChange={handleLibraryFileChange}
            />

            <button
              className="whiteboard-library-button"
              type="button"
              onClick={openLibraryFilePicker}
            >
              {libraryLabel}
            </button>

            <div className="whiteboard-library-market">
              <div className="whiteboard-library-market-header">
                <span>Top libraries</span>
                <strong>20</strong>
              </div>

              <div className="whiteboard-library-grid">
                {EXCALIDRAW_TOP_LIBRARIES.map((library) => {
                  const isLoading = activeTopLibrary === library.source;
                  const isAdded = addedTopLibrary === library.source;
                  const isFailed = failedTopLibrary === library.source;

                  return (
                    <button
                      className="whiteboard-library-card"
                      disabled={Boolean(activeTopLibrary)}
                      key={library.source}
                      type="button"
                      onClick={() => addTopLibrary(library)}
                    >
                      <img
                        alt=""
                        className="whiteboard-library-preview"
                        loading="lazy"
                        src={`${EXCALIDRAW_LIBRARY_BASE_URL}/${library.preview}`}
                      />

                      <span className="whiteboard-library-card-body">
                        <span className="whiteboard-library-card-title">
                          {library.name}
                        </span>
                        <span className="whiteboard-library-card-meta">
                          {formatDownloads(library.downloads)} downloads
                        </span>
                      </span>

                      <span className="whiteboard-library-card-action">
                        {isLoading
                          ? "Adding"
                          : isAdded
                            ? "Added"
                            : isFailed
                              ? "Failed"
                              : "Add"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          libraryHost
        )}

      <CursorLayer cursors={viewportCursors} />
    </div>
  );
}
