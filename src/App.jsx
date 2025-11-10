import React, { useEffect, useMemo, useRef, useState } from "react";
import { connectSignaling } from "./lib/signaling.js";
import { createPeer } from "./lib/webrtc.js";
import { sendFileInChunks, useReceiver } from "./lib/transfer.js";
import ProgressBar from "./components/ProgressBar.jsx";

function randomRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function App() {
  const [role, setRole] = useState("sender"); // "sender" or "receiver"
  const [roomId, setRoomId] = useState(randomRoomId());
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const signalingRef = useRef(null);
  const receiver = useReceiver(setProgress, setStatus, setDownloadUrl);

  const signalingUrl = import.meta.env.VITE_SIGNALING_URL || "http://localhost:3001";

  useEffect(() => {
    const { socket, joinRoom, onSignal, sendSignal, onPeerJoined } = connectSignaling(signalingUrl);
    signalingRef.current = { socket, joinRoom, onSignal, sendSignal };

    onSignal(async (data) => {
      const pc = pcRef.current;

      if (data.type === "offer") {
        setStatus("Received offer → creating answer...");
        await pc.setRemoteDescription(data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(roomId, answer);
      } else if (data.type === "answer") {
        setStatus("Received answer → connected");
        await pc.setRemoteDescription(data);
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data); } catch (e) { console.error(e); }
      }
    });

    onPeerJoined(() => {
      setStatus("Peer joined. If you are sender: creating offer...");
      if (role === "sender") void startOffer();
    });

    return () => socket.close();
  }, [roomId, role]);

  async function startOffer() {
    const pc = pcRef.current;
    const { sendSignal } = signalingRef.current;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(roomId, offer);
    setStatus("Offer sent. Waiting for answer...");
  }

  async function connect() {
    const pc = createPeer();
    pcRef.current = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) signalingRef.current.sendSignal(roomId, ev.candidate);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setConnected(true);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") setConnected(false);
    };
    if (role === "sender") {
      const dc = pc.createDataChannel("file", { ordered: true });
      dc.onopen = () => setStatus("DataChannel open. Ready to send.");
      dc.onclose = () => setStatus("DataChannel closed.");
      dcRef.current = dc;
    } else {
      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dcRef.current = dc;
        receiver.bind(dc);
      };
    }
    signalingRef.current.joinRoom(roomId);
    setStatus("Joined room. Waiting for peer...");
  }

  async function handleSend() {
    if (!file || !dcRef.current) return;
    setDownloadUrl(null);
    setProgress(0);
    setEta(null);
    setSpeed(0);
    setStatus("Calculating file hash...");
    await sendFileInChunks(dcRef.current, file, ({ progress, speed, eta }) => {
      setProgress(progress);
      setSpeed(speed);
      setEta(eta);
    }, setStatus);
  }

  const copy = () => navigator.clipboard.writeText(roomId);

  return (
    <div className="container">
      <div className="title">P2P Share <span className="subtitle">WebRTC (Browser-to-Browser)</span></div>

      <div className="card">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span className="badge">Role</span>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={() => setRole("sender")} disabled={connected} style={{ borderColor: role==="sender"?"#22c55e":"#334155" }}>Sender</button>
              <button onClick={() => setRole("receiver")} disabled={connected} style={{ borderColor: role==="receiver"?"#22c55e":"#334155" }}>Receiver</button>
            </div>
          </div>
          <div style={{ minWidth: 260 }}>
            <span className="badge">Room Code</span>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={roomId} onChange={e=>setRoomId(e.target.value)} className="kbd" />
              <button onClick={copy}>Copy</button>
              <button onClick={()=>setRoomId(randomRoomId())} disabled={connected}>New</button>
            </div>
          </div>
          <div>
            <span className="badge">Connection</span>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={connect} disabled={connected}>Connect</button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }} className="muted">
          Status: {status} {connected ? "✅" : "⏳"}
        </div>
      </div>

      {role === "sender" ? (
        <div className="card">
          <div className="grid">
            <div className="col-12">
              <span className="badge">Select File</span>
              <div className="row" style={{ marginTop: 8 }}>
                <input type="file" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} />
                <button onClick={handleSend} disabled={!connected || !file}>Send</button>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {file ? `${file.name} — ${(file.size/1024/1024).toFixed(2)} MB` : "No file chosen"}
              </div>
            </div>
            <div className="col-12">
              <ProgressBar progress={progress} />
              <div className="muted" style={{ marginTop: 6 }}>
                {progress.toFixed(1)}% · {speed ? `${(speed/1024/1024).toFixed(2)} MB/s` : "—"} {eta ? `· ETA ${Math.max(0, Math.ceil(eta))}s` : ""}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="grid">
            <div className="col-12">
              <span className="badge">Receive</span>
              <div className="muted" style={{ marginTop: 8 }}>
                After connecting, wait for sender. File will auto-download when complete.
              </div>
              <ProgressBar progress={progress} />
              <div className="muted" style={{ marginTop: 6 }}>
                {progress.toFixed(1)}%
              </div>
              {downloadUrl && (
                <div style={{ marginTop: 12 }}>
                  <a className="link" href={downloadUrl} download>Download received file</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="footer">
        This demo uses WebRTC DataChannels with a minimal Socket.IO signaling server. No file data touches the server.
      </div>
    </div>
  );
}
