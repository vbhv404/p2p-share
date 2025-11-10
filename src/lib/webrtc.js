export function createPeer() {
  const iceServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] },
  ];
  const pc = new RTCPeerConnection({ iceServers });
  return pc;
}
