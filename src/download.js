// 单张文件名和未压缩 ZIP。字节只在内存里，不进 localStorage。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function stamp(createdAt) {
  const date = new Date(createdAt);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function dosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function dosDate(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

export function makeFileKey(time = Date.now()) {
  const prefix = globalThis.crypto.randomUUID().slice(0, 6);
  return `${prefix}-${stamp(time)}`;
}

export function fileStem(item, time = Date.now()) {
  if (item && item.fileKey) return item.fileKey;
  return makeFileKey(item && item.createdAt ? item.createdAt : time);
}

export function imageFileName(item, time) {
  return `${fileStem(item, time)}.png`;
}

export function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function storedEntry(name, data, time, date, offset) {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const local = concatBytes([
    new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]),
    nameBytes,
    data,
  ]);
  const central = concatBytes([
    new Uint8Array([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ]),
    nameBytes,
  ]);
  return { local, central };
}

function imageBytes(item) {
  if (item && item.bytes) return item.bytes;
  return dataUrlToBytes(item.dataUrl);
}

// 通用打包：files = [{ name, data: Uint8Array }]，返回 zip 字节与文件名。
export function zipFiles(files, filename, createdAt = Date.now()) {
  const when = new Date(createdAt);
  const time = dosTime(when);
  const date = dosDate(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const entry = storedEntry(file.name, file.data, time, date, offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.length;
  }
  const centralBytes = concatBytes(centrals);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(centralBytes.length),
    ...u32(offset),
    ...u16(0),
  ]);
  return { filename, bytes: concatBytes([...locals, centralBytes, end]) };
}

export function zipBatch(batch) {
  const files = [];
  if (batch.base && (batch.base.bytes || batch.base.dataUrl)) {
    files.push({
      name: `images/${imageFileName(batch.base, batch.createdAt)}`,
      data: imageBytes(batch.base),
    });
  }
  for (const item of batch.items) {
    files.push({
      name: `images/${fileStem(item, batch.createdAt)}.png`,
      data: imageBytes(item),
    });
  }
  return zipFiles(files, `角色设定-${stamp(batch.createdAt)}.zip`, batch.createdAt);
}
