// AFIF ImgShrink — Disk Imager (read / write / verify SD cards and USB drives). © AFIF-TECH · Afif Khoury.
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), fsp = fs.promises, path = require("path"), zlib = require("zlib"), crypto = require("crypto");
const { EventEmitter } = require("events");

let BIN = path.join(__dirname, "bin", process.platform === "win32" ? "win" : "linux");
const exe = (n) => path.join(BIN, process.platform === "win32" ? n + ".exe" : n);
function setBinDir(d) { BIN = d; }
const BUS = { 1: "SCSI", 2: "ATAPI", 3: "ATA", 4: "1394", 5: "SSA", 6: "Fibre", 7: "USB", 8: "RAID", 10: "SAS", 11: "SATA", 12: "SD", 13: "MMC", 14: "Virtual", 15: "File-backed", 17: "NVMe", 18: "SCM", 19: "UFS" };

function runHelper(args, { input, onLine } = {}) {
  const p = spawn(exe("afif-disk"), args, { windowsHide: true, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  let out = "", err = "", buf = "";
  p.stdout.on("data", (d) => { out += d; if (onLine) { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); } } });
  p.stderr.on("data", (d) => (err += d));
  const done = new Promise((res, rej) => { p.on("error", rej); p.on("close", (code) => res({ code, out, err })); });
  return { proc: p, done };
}

async function listDisks(showAll) {
  let j;
  try { const r = await runHelper(["list"]).done; j = JSON.parse(r.out.trim().split("\n").pop()); }
  catch (e) { return { admin: false, disks: [], error: process.platform === "win32" ? "Could not list disks: " + e.message : "Disk access is only available on Windows." }; }
  let disks = j.disks.map((d) => ({ ...d, id: String(d.n), busName: BUS[d.bus] || "Disk", name: [d.vendor, d.product].filter(Boolean).join(" ") || "Disk " + d.n }));
  if (process.env.AFIF_FAKE_DISK) { const f = process.env.AFIF_FAKE_DISK; const s = fs.statSync(f).size; disks.push({ id: "file:" + f, n: 99, size: s, sector: 512, bus: 12, busName: "SD", removable: true, media: true, system: false, name: "AFIF Test SD card", letters: "T:" }); }
  disks = disks.filter((d) => !d.system && d.size > 0);
  // removable = USB / SD / MMC bus or removable media; the system disk is never listed
  const removable = (d) => d.removable || [7, 12, 13].includes(d.bus);
  return { admin: !!j.admin, disks: showAll ? disks : disks.filter(removable), hidden: showAll ? 0 : disks.filter((d) => !removable(d)).length };
}

// ---------------------------------------------------------------- image sources (plain / zip / gz / xz)
const kind = (f) => (/\.zip$/i.test(f) ? "zip" : /\.(gz|gzip)$/i.test(f) ? "gz" : /\.xz$/i.test(f) ? "xz" : "img");

async function zipEntry(file) {
  const fh = await fsp.open(file, "r");
  try {
    const size = (await fh.stat()).size, tail = Buffer.alloc(Math.min(size, 65557));
    await fh.read(tail, 0, tail.length, size - tail.length);
    const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (e < 0) throw new Error("Not a valid ZIP file.");
    let cdOff = tail.readUInt32LE(e + 16), cdSize = tail.readUInt32LE(e + 12), count = tail.readUInt16LE(e + 10);
    const z64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    if (z64 >= 0 && (cdOff === 0xffffffff || count === 0xffff)) { const off = Number(tail.readBigUInt64LE(z64 + 8)); const r = Buffer.alloc(56); await fh.read(r, 0, 56, off); count = Number(r.readBigUInt64LE(32)); cdSize = Number(r.readBigUInt64LE(40)); cdOff = Number(r.readBigUInt64LE(48)); }
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdOff);
    const ents = [];
    for (let p = 0, i = 0; i < count && p < cd.length; i++) {
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const ent = { method: cd.readUInt16LE(p + 10), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), lho: cd.readUInt32LE(p + 42), name: cd.toString("utf8", p + 46, p + 46 + nl) };
      let x = p + 46 + nl; const xe = x + xl;
      while (x + 4 <= xe) { const id = cd.readUInt16LE(x), l = cd.readUInt16LE(x + 2); if (id === 1) { let q = x + 4; if (ent.usize === 0xffffffff) { ent.usize = Number(cd.readBigUInt64LE(q)); q += 8; } if (ent.csize === 0xffffffff) { ent.csize = Number(cd.readBigUInt64LE(q)); q += 8; } if (ent.lho === 0xffffffff) ent.lho = Number(cd.readBigUInt64LE(q)); } x += 4 + l; }
      ents.push(ent); p = xe + cl;
    }
    const ent = ents.find((x) => /\.img$/i.test(x.name)) || ents.filter((x) => !x.name.endsWith("/")).sort((a, b) => b.usize - a.usize)[0];
    if (!ent) throw new Error("The ZIP file is empty.");
    if (ent.method !== 0 && ent.method !== 8) throw new Error("This ZIP uses an unsupported compression method (" + ent.method + ").");
    const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, ent.lho);
    ent.dataStart = ent.lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    return ent;
  } finally { await fh.close(); }
}
async function xzSize(file) {
  const r = await new Promise((res) => { const p = spawn(exe("xz"), ["--robot", "--list", file], { windowsHide: true }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", () => res(o)); p.on("error", () => res("")); });
  const t = r.split("\n").find((l) => l.startsWith("totals")); return t ? Number(t.split("\t")[4]) || 0 : 0;
}
async function inspect(file) {
  const st = await fsp.stat(file), k = kind(file);
  const r = { file, kind: k, fileSize: st.size, size: k === "img" ? st.size : 0 };
  if (k === "zip") { const e = await zipEntry(file); r.size = e.usize; r.inner = e.name; }
  if (k === "xz") r.size = await xzSize(file);
  if (k === "gz") { const fh = await fsp.open(file, "r"); const b = Buffer.alloc(4); await fh.read(b, 0, 4, st.size - 4); await fh.close(); r.sizeGuess = b.readUInt32LE(0); }
  return r;
}
// readable stream of the raw image + counter of compressed bytes consumed
async function openSource(file) {
  const k = kind(file), info = await inspect(file);
  let consumed = 0; const count = (s) => (s.on("data", (c) => (consumed += c.length)), s);
  if (k === "img") return { info, stream: count(fs.createReadStream(file, { highWaterMark: 4 << 20 })), consumed: () => consumed, total: info.fileSize };
  if (k === "gz") return { info, stream: count(fs.createReadStream(file, { highWaterMark: 4 << 20 })).pipe(zlib.createGunzip({ chunkSize: 1 << 20 })), consumed: () => consumed, total: info.fileSize };
  if (k === "zip") {
    const e = await zipEntry(file); const raw = count(fs.createReadStream(file, { start: e.dataStart, end: e.dataStart + e.csize - 1, highWaterMark: 4 << 20 }));
    return { info, stream: e.method === 8 ? raw.pipe(zlib.createInflateRaw({ chunkSize: 1 << 20 })) : raw, consumed: () => consumed, total: e.csize };
  }
  const p = spawn(exe("xz"), ["-dc", "-T0", file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = 0; p.stdout.on("data", (c) => (out += c.length));
  return { info, stream: p.stdout, proc: p, consumed: () => out, total: info.size || 1, byOutput: true };
}

// ---------------------------------------------------------------- jobs
class DiskJob extends EventEmitter {
  constructor(op, o) { super(); this.op = op; this.o = o; this.cancelled = false; }
  cancel() { this.cancelled = true; try { this.proc?.kill(); } catch {} try { this.src?.proc?.kill(); } catch {} try { this.src?.stream?.destroy(); } catch {} }
  log(m, k = "") { this.emit("log", { msg: m, kind: k }); }
  prog(phase, done, total, t0) {
    const s = (Date.now() - t0) / 1000, speed = s > 0.5 ? done / s : 0;
    this.emit("progress", { phase, done, total, speed, eta: speed && total ? (total - done) / speed : null });
  }
  async helper(args, phase, srcFile) {
    const t0 = Date.now(); let total = 0, err = null, warn = [];
    let src = null;
    if (srcFile && kind(srcFile) !== "img") { src = this.src = await openSource(srcFile); }
    const h = runHelper(src ? [args[0], "-", args[2], String(src.info.size || 0)] : args, {
      input: !!src,
      onLine: (l) => {
        if (l.startsWith("S ")) total = Number(l.slice(2));
        else if (l.startsWith("P ")) { if (!src) { const [d, t] = l.slice(2).split(" ").map(Number); this.prog(phase, d, t || total, t0); } }
        else if (l.startsWith("E ")) err = l.slice(2);
        else if (l.startsWith("W ")) { warn.push(l.slice(2)); this.log(l.slice(2), "warn"); }
      },
    });
    this.proc = h.proc;
    let timer;
    if (src) {
      timer = setInterval(() => { const d = src.consumed(); this.prog(phase, Math.min(d, src.total), src.total, t0); }, 250);
      src.stream.on("error", (e) => { err = err || "Could not decompress the image: " + e.message; try { h.proc.kill(); } catch {} });
      h.proc.stdin.on("error", () => {});
      src.stream.pipe(h.proc.stdin);
    }
    const r = await h.done; clearInterval(timer);
    if (this.cancelled) throw new Error("Cancelled.");
    if (r.code !== 0 || err) throw new Error(err || (r.err.trim() || "The disk helper stopped (code " + r.code + ")."));
    const n = r.out.match(/^N (\d+)/m); return { bytes: n ? Number(n[1]) : total, seconds: (Date.now() - t0) / 1000 };
  }
  async start() {
    const o = this.o, d = o.disk;
    if (this.op === "read") {
      this.log(`Reading ${d.name} (${d.letters || "no drive letter"}) to ${o.file}${o.allocated ? " · allocated partitions only" : ""}`);
      const r = await this.helper(["read", d.id, o.file, o.allocated ? "alloc" : "all"], "read");
      this.log(`Read ${r.bytes} bytes in ${r.seconds.toFixed(1)} s`);
      return { op: "read", file: o.file, bytes: (await fsp.stat(o.file)).size, seconds: r.seconds };
    }
    if (this.op === "write" || this.op === "verify") {
      let w = null;
      if (this.op === "write") {
        this.log(`Writing ${o.file} to ${d.name} (${d.letters || "disk " + d.n})`);
        w = await this.helper(["write", o.file, d.id], "write", o.file);
        this.log(`Wrote ${w.bytes} bytes in ${w.seconds.toFixed(1)} s`);
      }
      let v = null;
      if (this.op === "verify" || o.verify) {
        this.log(`Verifying ${d.name} against ${o.file}`);
        v = await this.helper(["verify", o.file, d.id], "verify", o.file);
        this.log("Verify successful: the device matches the image.");
      }
      return { op: this.op, file: o.file, bytes: (w || v).bytes, seconds: (w?.seconds || 0) + (v?.seconds || 0), verified: !!v };
    }
    throw new Error("Unknown operation");
  }
}

function hashFile(file, algo, onProg, isCancelled) {
  return new Promise((res, rej) => {
    const h = crypto.createHash(algo), total = fs.statSync(file).size; let done = 0, last = 0;
    const s = fs.createReadStream(file, { highWaterMark: 4 << 20 });
    s.on("data", (c) => { h.update(c); done += c.length; const n = Date.now(); if (n - last > 150) { last = n; onProg?.(done / total); } if (isCancelled?.()) s.destroy(new Error("Cancelled.")); });
    s.on("end", () => res(h.digest("hex"))); s.on("error", rej);
  });
}

module.exports = { listDisks, inspect, DiskJob, hashFile, setBinDir, kind };
