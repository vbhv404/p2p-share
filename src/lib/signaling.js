import { io } from "socket.io-client";

export function connectSignaling(url) {
  const socket = io(url, { transports: ["websocket"] });

  function joinRoom(roomId) {
    socket.emit("join", { roomId });
  }
  function onSignal(handler) {
    socket.on("signal", handler);
  }
  function sendSignal(roomId, data) {
    socket.emit("signal", { roomId, data });
  }
  function onPeerJoined(handler) {
    socket.on("peer-joined", handler);
  }
  return { socket, joinRoom, onSignal, sendSignal, onPeerJoined };
}
