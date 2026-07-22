(function initDomClipperZipWriter(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (root) {
    root.DOMClipperZipWriter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createZipWriter() {
  const encoder = new TextEncoder();
  const utf8Flag = 0x0800;
  const maxUint16 = 0xffff;
  const maxUint32 = 0xffffffff;
  let crcTable = null;

  function getCrcTable() {
    if (crcTable) {
      return crcTable;
    }

    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function toBytes(data) {
    if (data === undefined || data === null) {
      return new Uint8Array();
    }

    if (typeof data === "string") {
      return encoder.encode(data);
    }

    if (ArrayBuffer.isView(data)) {
      const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const copy = new Uint8Array(view.length);
      copy.set(view);
      return copy;
    }

    const tag = Object.prototype.toString.call(data);
    if (tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]") {
      const view = new Uint8Array(data);
      const copy = new Uint8Array(view.length);
      copy.set(view);
      return copy;
    }

    throw new TypeError("ZIP entry data must be a string, Uint8Array, ArrayBuffer, or ArrayBuffer view.");
  }

  function crc32(data) {
    const bytes = toBytes(data);
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function assertZip16(value, label) {
    if (value > maxUint16) {
      throw new RangeError(`${label} exceeds ZIP32 limit (${maxUint16}). ZIP64 is not supported.`);
    }
  }

  function assertZip32(value, label) {
    if (value > maxUint32) {
      throw new RangeError(`${label} exceeds ZIP32 limit (${maxUint32}). ZIP64 is not supported.`);
    }
  }

  function validateEntryPath(path) {
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("Unsafe ZIP entry path: path must not be empty.");
    }

    if (
      path.startsWith("/") ||
      /^[A-Za-z]:/.test(path) ||
      path.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(path)
    ) {
      throw new Error(`Unsafe ZIP entry path: ${path}`);
    }

    const segments = path.split("/");
    if (segments.some((segment) => segment === "" || segment === "..")) {
      throw new Error(`Unsafe ZIP entry path: ${path}`);
    }
  }

  function concat(chunks, sizeLabel = "ZIP archive size") {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    assertZip32(total, sizeLabel);

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function createLocalHeader(nameBytes, data, checksum) {
    assertZip16(nameBytes.length, "ZIP entry file name length");
    assertZip32(data.length, "ZIP entry data size");

    const header = new Uint8Array(30 + nameBytes.length);
    writeUint32(header, 0, 0x04034b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 6, utf8Flag);
    writeUint16(header, 8, 0);
    writeUint16(header, 10, 0);
    writeUint16(header, 12, 0);
    writeUint32(header, 14, checksum);
    writeUint32(header, 18, data.length);
    writeUint32(header, 22, data.length);
    writeUint16(header, 26, nameBytes.length);
    writeUint16(header, 28, 0);
    header.set(nameBytes, 30);
    return header;
  }

  function createCentralHeader(nameBytes, data, checksum, localOffset) {
    assertZip16(nameBytes.length, "ZIP entry file name length");
    assertZip32(data.length, "ZIP entry data size");
    assertZip32(localOffset, "ZIP local header offset");

    const header = new Uint8Array(46 + nameBytes.length);
    writeUint32(header, 0, 0x02014b50);
    writeUint16(header, 4, 20);
    writeUint16(header, 6, 20);
    writeUint16(header, 8, utf8Flag);
    writeUint16(header, 10, 0);
    writeUint16(header, 12, 0);
    writeUint16(header, 14, 0);
    writeUint32(header, 16, checksum);
    writeUint32(header, 20, data.length);
    writeUint32(header, 24, data.length);
    writeUint16(header, 28, nameBytes.length);
    writeUint16(header, 30, 0);
    writeUint16(header, 32, 0);
    writeUint16(header, 34, 0);
    writeUint16(header, 36, 0);
    writeUint32(header, 38, 0);
    writeUint32(header, 42, localOffset);
    header.set(nameBytes, 46);
    return header;
  }

  function createEndRecord(entryCount, centralSize, centralOffset) {
    assertZip16(entryCount, "ZIP entry count");
    assertZip32(centralSize, "ZIP central directory size");
    assertZip32(centralOffset, "ZIP central directory offset");

    const record = new Uint8Array(22);
    writeUint32(record, 0, 0x06054b50);
    writeUint16(record, 4, 0);
    writeUint16(record, 6, 0);
    writeUint16(record, 8, entryCount);
    writeUint16(record, 10, entryCount);
    writeUint32(record, 12, centralSize);
    writeUint32(record, 16, centralOffset);
    writeUint16(record, 20, 0);
    return record;
  }

  function createZip(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError("createZip entries must be an array.");
    }

    assertZip16(entries.length, "ZIP entry count");

    const seenPaths = new Set();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        throw new TypeError("ZIP entries must be objects with path and data.");
      }

      validateEntryPath(entry.path);
      if (seenPaths.has(entry.path)) {
        throw new Error(`Duplicate ZIP entry path: ${entry.path}`);
      }
      seenPaths.add(entry.path);

      const nameBytes = encoder.encode(entry.path);
      const data = toBytes(entry.data);
      const checksum = crc32(data);
      const localHeader = createLocalHeader(nameBytes, data, checksum);
      const centralHeader = createCentralHeader(nameBytes, data, checksum, offset);

      localChunks.push(localHeader, data);
      centralChunks.push(centralHeader);
      offset += localHeader.length + data.length;
      assertZip32(offset, "ZIP local header offset");
    }

    const centralOffset = offset;
    const central = concat(centralChunks, "ZIP central directory size");
    const end = createEndRecord(entries.length, central.length, centralOffset);
    return concat(localChunks.concat(central, end));
  }

  return {
    crc32,
    createZip
  };
});
