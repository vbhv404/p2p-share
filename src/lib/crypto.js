// App-layer E2E crypto using Web Crypto:
// - ECDH (P-256) for key agreement
// - derive AES-GCM key from ECDH shared bits via SHA-256
// - encrypt/decrypt per chunk with random 96-bit IV

export async function generateECDH() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  return keyPair;
}

export async function exportPubKeyJwk(publicKey) {
  return await crypto.subtle.exportKey("jwk", publicKey);
}

export async function importPubKeyJwk(jwk) {
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

export async function deriveAesKey(myPrivateKey, theirPublicKey) {
  // 1) derive raw shared bits
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256
  );
  // 2) hash to 256-bit
  const hash = await crypto.subtle.digest("SHA-256", bits);
  // 3) import as AES-GCM key
  return await crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function aesGcmEncrypt(aesKey, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);
  return { iv: Array.from(iv), ct: new Uint8Array(ct) };
}

export async function aesGcmDecrypt(aesKey, ivArray, ctU8) {
  const iv = new Uint8Array(ivArray);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ctU8);
  return new Uint8Array(pt);
}

export async function sha256(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
