import { generateECDH, exportPubKeyJwk, importPubKeyJwk, deriveAesKey, aesGcmEncrypt, aesGcmDecrypt, sha256 } from "./crypto.js";

// Sender: send file in chunks over a DataChannel with app-layer E2E (AES-GCM) after ECDH key exchange
export async function sendFileInChunks(dc, file, onProgress, setStatus) {
  // Phase 0: prepare crypto
  const myKeys = await generateECDH();
  const myPubJwk = await exportPubKeyJwk(myKeys.publicKey);

  // Phase 1: compute file hash for integrity (demo scale)
  setStatus("Calculating file hash (SHA-256)...");
  const fileArrayBuffer = await file.arrayBuffer();
  const fileHash = await sha256(fileArrayBuffer);

  // Phase 2: send metadata w/ ECDH public key
  const meta = { type: "meta", name: file.name, size: file.size, hash: fileHash, ecdhPub: myPubJwk };
  dc.send(JSON.stringify(meta));

  // Phase 3: wait for receiver's public key
  setStatus("Waiting for receiver's E2E key...");
  const peerPubJwk = await waitForPeerPubKey(dc);
  const peerPubKey = await importPubKeyJwk(peerPubJwk);
  const aesKey = await deriveAesKey(myKeys.privateKey, peerPubKey);

  // Phase 4: stream encrypted chunks
  const CHUNK = 64 * 1024; // 64KB
  const total = file.size;
  let sent = 0;
  let lastTime = performance.now();
  let lastSent = 0;

  setStatus("Sending (encrypted)...");
  const reader = new Blob([fileArrayBuffer]).stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    let offset = 0;
    while (offset < value.byteLength) {
      const slice = value.subarray(offset, Math.min(offset + CHUNK, value.byteLength));
      const { iv, ct } = await aesGcmEncrypt(aesKey, slice);
      // send as JSON header + binary body: {type:"chunk", iv:[...], len:ct.length} then ct
      dc.send(JSON.stringify({ type: "chunk", iv, len: ct.length }));
      dc.send(ct);

      sent += slice.byteLength;
      offset += slice.byteLength;

      const now = performance.now();
      if (now - lastTime >= 500) {
        const deltaBytes = sent - lastSent;
        const deltaSec = (now - lastTime) / 1000;
        const speed = deltaBytes / deltaSec;
        const remaining = total - sent;
        const eta = speed > 0 ? remaining / speed : null;
        onProgress({ progress: (sent / total) * 100, speed, eta });
        lastTime = now;
        lastSent = sent;
      }
    }
  }

  // Phase 5: signal end
  dc.send(JSON.stringify({ type: "end" }));
  onProgress({ progress: 100, speed: 0, eta: 0 });
  setStatus("Completed (encrypted).");
}

function waitForPeerPubKey(dc) {
  return new Promise((resolve) => {
    const handler = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "ekey" && msg.pub) {
            dc.removeEventListener("message", handler);
            resolve(msg.pub);
          }
        } catch {}
      }
    };
    dc.addEventListener("message", handler);
  });
}

export function useReceiver(setProgress, setStatus, setDownloadUrl) {
  let meta = null;
  let receivedBytes = 0;
  let chunks = [];
  let expectingBinary = 0;
  let pendingChunkInfo = null;

  // E2E crypto state
  let myKeys = null;
  let aesKey = null;

  async function bind(dc) {
    setStatus("DataChannel open. Waiting for metadata...");
    dc.binaryType = "arraybuffer";

    myKeys = await generateECDH();

    dc.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { msg = null; }
        if (!msg) return;

        if (msg.type === "meta") {
          meta = msg;
          setStatus(`Receiving: ${meta.name} (${(meta.size/1024/1024).toFixed(2)} MB)`);
          // Derive E2E key and respond with my public key
          const senderPub = await importPubKeyJwk(meta.ecdhPub);
          aesKey = await deriveAesKey(myKeys.privateKey, senderPub);
          const myPubJwk = await exportPubKeyJwk(myKeys.publicKey);
          dc.send(JSON.stringify({ type: "ekey", pub: myPubJwk }));
        } else if (msg.type === "chunk") {
          // Next message is binary ciphertext of length msg.len
          pendingChunkInfo = msg;
          expectingBinary = msg.len;
        } else if (msg.type === "end") {
          const blob = new Blob(chunks);
          // Integrity verify against meta.hash
          const hash = await sha256(await blob.arrayBuffer());
          if (meta?.hash && hash !== meta.hash) {
            setStatus("Integrity check failed ❌");
            return;
          }
          const url = URL.createObjectURL(blob);
          setDownloadUrl(url);
          setStatus("Completed. Integrity OK ✅ (encrypted)");
        }
      } else if (ev.data instanceof ArrayBuffer) {
        if (!pendingChunkInfo) return;
        // accumulate binary chunk possibly split by transport; here we assume browser delivers as one
        const ct = new Uint8Array(ev.data);
        // decrypt
        const pt = await aesGcmDecrypt(aesKey, pendingChunkInfo.iv, ct);
        chunks.push(pt);
        receivedBytes += pt.byteLength;
        pendingChunkInfo = null;
        expectingBinary = 0;

        if (meta?.size) {
          setProgress((receivedBytes / meta.size) * 100);
        }
      }
    };
  }
  return { bind };
}
