import { io } from "socket.io-client";

const SOCKET_URL = window.location.origin;

export const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  path: "/socket.io",
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
});
