export function signed8(b) {
  if (b > 127) return -256 + b;
  else return b;
}

export function signed16(v) {
  v &= 0xffff;
  if (v > 0x7fff) return -0x10000 + v;
  else return v;
}

export function signed24(v) {
  v &= 0xffffff;
  if (v > 0x7fffff) return -0x1000000 + v;
  else return v;
}

export function readSigned(stream, n) {
  const byte = new Uint8Array(stream.read(n));
  let signed_bytes = [];
  for (let b of byte) {
    signed_bytes.push(signed8(b));
  }
  return signed_bytes;
}

export function readSint8(stream) {
  const byte = new Uint8Array(stream.read(1));
  if (byte.length == 1) return signed8(byte[0]);
  return null;
}

export function readInt8(stream) {
  const byte = new Uint8Array(stream.read(1));
  if (byte.length == 1) return byte[0];
  return null;
}

export function readInt16le(stream) {
  const byte = new Uint8Array(stream.read(2));
  if (byte.length == 2) return (byte[0] & 0xff) + ((byte[1] & 0xff) << 8);
  return null;
}

export function readInt16be(stream) {
  const byte = new Uint8Array(stream.read(2));
  if (byte.length == 2) return (byte[1] & 0xff) + ((byte[0] & 0xff) << 8);
  return null;
}

export function readInt24le(stream) {
  const b = new Uint8Array(stream.read(3));
  if (b.length == 3)
    return (b[0] & 0xff) + ((b[1] & 0xff) << 8) + ((b[2] & 0xff) << 16);
  return null;
}

export function readInt24be(stream) {
  const b = new Uint8Array(stream.read(3));
  if (b.length == 3)
    return (b[2] & 0xff) + ((b[1] & 0xff) << 8) + ((b[0] & 0xff) << 16);
  return null;
}

export function readInt32le(stream) {
  const b = new Uint8Array(stream.read(4));
  if (b.length == 4)
    return (
      (b[0] & 0xff) +
      ((b[1] & 0xff) << 8) +
      ((b[2] & 0xff) << 16) +
      ((b[3] & 0xff) << 24)
    );
  return null;
}

export function readInt32be(stream) {
  const b = new Uint8Array(stream.read(4));
  if (b.length == 4)
    return (
      (b[3] & 0xff) +
      ((b[2] & 0xff) << 8) +
      ((b[1] & 0xff) << 16) +
      ((b[0] & 0xff) << 24)
    );
  return null;
}

export function readString8(stream, length) {
  const byte = stream.read(length);
  try {
    return String.fromCharCode(...byte);
  } catch (e) {
    console.error("read_string_8", e);
    return null; // Must be > 128 chars.
  }
}

export function readString16(stream, length) {
  const byte = stream.read(length);
  try {
    return byte.decode("utf16");
  } catch {
    console.error("read_string_16");
    return null;
  }
}
