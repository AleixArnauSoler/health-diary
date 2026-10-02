// Diary – encryption of the files uploaded to GitHub (AES-256-GCM, built into Safari's Web Crypto).
// The key is 32 random bytes, shown as base64 text (44 characters) so you can save it in the
// Passwords app and put it in a key file for the R/Python scripts.
// File format: { "enc": "AES-GCM", "iv": base64 (12 bytes), "ct": base64 (ciphertext + 16-byte tag) }

const ALGORITHM = 'AES-GCM';

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text) {
  return Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));
}

export function newKeyText() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function isValidKeyText(text) {
  try {
    return typeof text === 'string' && fromBase64(text).length === 32;
  } catch {
    return false;
  }
}

let cached = { text: null, key: null };

async function importKey(keyText) {
  if (cached.text !== keyText) {
    const key = await crypto.subtle.importKey('raw', fromBase64(keyText), ALGORITHM, false, ['encrypt', 'decrypt']);
    cached = { text: keyText, key };
  }
  return cached.key;
}

export async function encryptJSON(keyText, object) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(object));
  const cipher = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, await importKey(keyText), plain);
  return { enc: ALGORITHM, iv: toBase64(iv), ct: toBase64(new Uint8Array(cipher)) };
}

export async function decryptJSON(keyText, envelope) {
  if (!envelope || envelope.enc !== ALGORITHM) throw new Error('This is not an encrypted diary file.');
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: fromBase64(envelope.iv) }, await importKey(keyText), fromBase64(envelope.ct));
  } catch {
    throw new Error('Could not decrypt your entries with this key.');
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
