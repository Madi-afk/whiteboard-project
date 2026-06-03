import { io } from "socket.io-client";

const SOCKET_URL = `http://${window.location.hostname}:8000`;

export const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  autoConnect: false,
});