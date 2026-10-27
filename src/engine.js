// AFIF ImgShrink — shrinking engine (main process).
// Same idea as PiShrink: check the last ext2/3/4 partition, shrink the filesystem to its minimum (plus a
// little headroom), shrink the partition entry, cut the image file, optionally add first-boot auto-expand
// and compress. Filesystem work is done by e2fsprogs (e2fsck, resize2fs) and afif-e2tool, built for Windows.
"use strict";
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const SECTOR = 512;
let BIN = path.join(__dirname, "bin", process.platform === "win32" ? "win" : "linux");
const exe = (n) => path.join(BIN, process.platform === "win32" ? n + ".exe" : n);
function setBinDir(d) { BIN = d; }

// ---------------------------------------------------------------- low level file helpers
async function readAt(fh, pos, len) { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, pos); return b.subarray(0, bytesRead); }
async function writeAt(fh, pos, buf) { await fh.write(buf, 0, buf.length, pos); }

// ---------------------------------------------------------------- partition tables
const MBR_TYPES = { 0x01: "FAT12", 0x04: "FAT16", 0x06: "FAT16", 0x07: "NTFS/exFAT", 0x0b: "FAT32", 0x0c: "FAT32 (LBA)", 0x0e: "FAT16 (LBA)", 0x05: "Extended", 0x0f: "Extended (LBA)", 0x82: "Linux swap", 0x83: "Linux", 0x85: "Linux extended", 0x8e: "Linux LVM", 0xee: "GPT protective", 0xef: "EFI" };
const isExt = (t) => t === 0x05 || t === 0x0f || t === 0x85;
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
const GUID = (b, o) => { const h = (i, l, le) => { const s = b.subarray(o + i, o + i + l); return (le ? Buffer.from(s).reverse() : s).toString("hex"); }; return `${h(0, 4, 1)}-${h(4, 2, 1)}-${h(6, 2, 1)}-${h(8, 2)}-${h(10, 6)}`.toUpperCase(); };
const GPT_TYPES = { "0FC63DAF-8483-4772-8E79-3D69D8477DE4": "Linux filesystem", "C12A7328-F81F-11D2-BA4B-00A0C93EC93B": "EFI System", "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7": "Microsoft basic data", "4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709": "Linux root (x86-64)", "B921B045-1DF0-41C3-AF44-4C6F280D3FAE": "Linux root (ARM64)" };

async function readTable(fh, fileSize) {
  const mbr = await readAt(fh, 0, SECTOR);
  if (mbr.length < 512 || mbr[510] !== 0x55 || mbr[511] !== 0xaa) throw new Error("This file has no partition table. Choose a whole disk image (.img) made from an SD card or USB drive.");
  const prim = [];
  for (let i = 0; i < 4; i++) { const o = 446 + i * 16, type = mbr[o + 4], start = mbr.readUInt32LE(o + 8), size = mbr.readUInt32LE(o + 12); if (type && size) prim.push({ index: i, num: i + 1, type, start, size, entryOffset: o }); }
  if (prim.some((p) => p.type === 0xee)) return readGpt(fh, fileSize);
  const parts = [];
  for (const p of prim) {
    if (isExt(p.type)) {
      parts.push({ ...p, kind: "extended", name: MBR_TYPES[p.type] });
      // walk the EBR chain
      let ebr = p.start, n = 5, guard = 0;
      while (ebr && guard++ < 128) {
        const b = await readAt(fh, ebr * SECTOR, SECTOR); if (b[510] !== 0x55 || b[511] !== 0xaa) break;
        const t = b[446 + 4], s = b.readUInt32LE(446 + 8), z = b.readUInt32LE(446 + 12);
        if (t && z) parts.push({ num: n++, type: t, start: ebr + s, size: z, kind: "logical", ebr, entryOffset: ebr * SECTOR + 446, name: MBR_TYPES[t] || "0x" + t.toString(16) });
        const nt = b[462 + 4], ns = b.readUInt32LE(462 + 8);
        ebr = nt ? p.start + ns : 0;
      }
    } else parts.push({ ...p, kind: "primary", name: MBR_TYPES[p.type] || "0x" + p.type.toString(16) });
  }
  return { scheme: "MBR", parts, diskSig: mbr.readUInt32LE(440).toString(16).padStart(8, "0") };
}
async function readGpt(fh, fileSize) {
  const h = await readAt(fh, SECTOR, SECTOR);
  if (h.toString("latin1", 0, 8) !== "EFI PART") throw new Error("The GPT partition table is damaged.");
  const entLba = Number(h.readBigUInt64LE(72)), count = h.readUInt32LE(80), esz = h.readUInt32LE(84);
  const ents = await readAt(fh, entLba * SECTOR, count * esz);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const o = i * esz, tg = GUID(ents, o); if (/^0+-0+-0+-0+-0+$/.test(tg.replace(/0/g, "0"))) { if (ents.subarray(o, o + 16).every((x) => !x)) continue; }
    const first = Number(ents.readBigUInt64LE(o + 32)), last = Number(ents.readBigUInt64LE(o + 40));
    const name = ents.toString("utf16le", o + 56, o + 128).replace(/\0.*$/, "");
    parts.push({ num: i + 1, index: i, start: first, size: last - first + 1, kind: "gpt", typeGuid: tg, name: name || GPT_TYPES[tg] || "GPT partition", entryOffset: entLba * SECTOR + o });
  }
  return { scheme: "GPT", parts, gpt: { header: h, entLba, count, esz, myLba: Number(h.readBigUInt64LE(24)), altLba: Number(h.readBigUInt64LE(32)) } };
}

// ---------------------------------------------------------------- ext superblock
async function readExt(fh, startSector) {
  const sb = await readAt(fh, startSector * SECTOR + 1024, 1024);
  if (sb.length < 1024 || sb.readUInt16LE(56) !== 0xef53) return null;
  const incompat = sb.readUInt32LE(96), compat = sb.readUInt32LE(92), ro = sb.readUInt32LE(100);
  const is64 = !!(incompat & 0x80);
  const blocks = sb.readUInt32LE(4) + (is64 ? sb.readUInt32LE(0x150) * 2 ** 32 : 0);
  const free = sb.readUInt32LE(12) + (is64 ? sb.readUInt32LE(0x158) * 2 ** 32 : 0);
  const bs = 1024 << sb.readUInt32LE(24);
  const kind = incompat & 0x40 || incompat & 0x200 || ro & 0x8 ? "ext4" : compat & 0x4 ? "ext3" : "ext2";
  return { kind, blockSize: bs, blocks, freeBlocks: free, usedBlocks: blocks - free, inodes: sb.readUInt32LE(0), freeInodes: sb.readUInt32LE(16),
    label: sb.toString("latin1", 120, 136).replace(/\0.*$/, ""), lastMount: sb.toString("latin1", 136, 200).replace(/\0.*$/, ""), state: sb.readUInt16LE(58), mtime: sb.readUInt32LE(44), uuid: sb.subarray(104, 120).toString("hex") };
}

async function analyze(file) {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error("Please choose an image file, not a folder or drive.");
  const fh = await fsp.open(file, "r");
  try {
    const t = await readTable(fh, st.size);
    const real = t.parts.filter((p) => p.kind !== "extended");
    if (!real.length) throw new Error("No partitions were found in this image.");
    for (const p of real) { p.bytes = p.size * SECTOR; p.fs = await readExt(fh, p.start); if (!p.fs) { const boot = await readAt(fh, p.start * SECTOR, 512); const oem = boot.toString("latin1", 3, 11); p.fsLabel = /FAT|MSDOS|mkfs/.test(oem + boot.toString("latin1", 82, 90)) ? "FAT" : p.name; } }
    const last = real.reduce((a, b) => (b.start > a.start ? b : a));
    const r = { file, size: st.size, scheme: t.scheme, parts: t.parts, last: last.num, diskSig: t.diskSig };
    if (!last.fs) { r.problem = `The last partition (#${last.num}, ${last.fsLabel || last.name}) is not an ext2/3/4 filesystem, so it cannot be shrunk. Raspberry Pi OS, Ubuntu and most Linux images use ext4 here.`; return r; }
    const endBytes = (last.start + last.size) * SECTOR + (t.scheme === "GPT" ? 33 * SECTOR : 0);
    r.used = last.start * SECTOR + last.fs.usedBlocks * last.fs.blockSize;
    r.estimate = Math.min(st.size, last.start * SECTOR + Math.ceil(last.fs.usedBlocks * 1.02 + 5000) * last.fs.blockSize + (t.scheme === "GPT" ? 33 * SECTOR : 0));
    r.trailing = Math.max(0, st.size - endBytes);
    return r;
  } finally { await fh.close(); }
}

// ---------------------------------------------------------------- run tools
function run(cmd, args, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "", err = "", buf = "";
    const feed = (d, isErr) => {
      const s = d.toString("utf8"); if (isErr) err += s; else out += s;
      buf += s; const parts = buf.split(/\r|\n/); buf = parts.pop(); parts.forEach((l) => l.trim() && onLine?.(l));
    };
    p.stdout.on("data", (d) => feed(d, false)); p.stderr.on("data", (d) => feed(d, true));
    p.on("error", reject);
    p.on("close", (code) => { if (buf.trim()) onLine?.(buf); resolve({ code, out, err }); });
    if (signal) signal.onAbort = () => { try { p.kill(); } catch {} };
  });
}

// ---------------------------------------------------------------- first-boot auto expand (written to /etc/rc.local)
const EXPAND_SCRIPT = `#!/bin/bash
# AFIF ImgShrink — grow the root partition to fill the card on first boot, then put the original rc.local back.
restore_rc() {
  rm -f /etc/rc.local
  if [ -f /etc/rc.local.bak ]; then cp -fp /etc/rc.local.bak /etc/rc.local && /etc/rc.local; fi
}
# 1) Raspberry Pi OS: let raspi-config do it
if command -v raspi-config >/dev/null 2>&1; then
  if raspi-config --expand-rootfs >/dev/null 2>&1; then restore_rc; reboot; exit 0; fi
fi
# 2) generic: grow the partition with sfdisk/growpart, then resize the filesystem on the next boot
ROOT_PART=$(findmnt -n -o SOURCE / 2>/dev/null)
ROOT_DEV="/dev/$(lsblk -no pkname "$ROOT_PART" 2>/dev/null | head -1)"
PART_NUM=$(cat "/sys/class/block/$(basename "$ROOT_PART")/partition" 2>/dev/null)
if [ -b "$ROOT_DEV" ] && [ -n "$PART_NUM" ]; then
  if command -v growpart >/dev/null 2>&1; then growpart "$ROOT_DEV" "$PART_NUM"
  else echo ", +" | sfdisk --no-reread -N "$PART_NUM" "$ROOT_DEV"; fi
  cat > /etc/rc.local <<EOF
#!/bin/sh
resize2fs $ROOT_PART
rm -f /etc/rc.local
if [ -f /etc/rc.local.bak ]; then cp -fp /etc/rc.local.bak /etc/rc.local && /etc/rc.local; fi
exit 0
EOF
  chmod +x /etc/rc.local
  reboot
  exit 0
fi
echo "AFIF ImgShrink: could not expand the root filesystem automatically."
restore_rc
exit 0
`;

// ---------------------------------------------------------------- the shrink job
class Job extends EventEmitter {
  constructor(opts) { super(); this.o = opts; this.cancelled = false; this.sig = {}; }
  cancel() { this.cancelled = true; this.sig.onAbort?.(); }
  log(msg, kind = "") { this.emit("log", { msg, kind, t: Date.now() }); }
  step(id, state, extra) { this.emit("step", { id, state, ...extra }); }
  prog(id, frac, text) { this.emit("progress", { id, frac, text }); }
  check() { if (this.cancelled) throw new Error("Cancelled."); }
  dev(start) { return `${this.work}?offset=${start * SECTOR}`; }

  async copy(src, dst) {
    const total = (await fsp.stat(src)).size; let done = 0, last = 0;
    await new Promise((res, rej) => {
      const r = fs.createReadStream(src, { highWaterMark: 4 << 20 }), w = fs.createWriteStream(dst, { highWaterMark: 4 << 20 });
      r.on("data", (c) => { done += c.length; const now = Date.now(); if (now - last > 150) { last = now; this.prog("copy", done / total, `${fmt(done)} of ${fmt(total)}`); } if (this.cancelled) { r.destroy(new Error("Cancelled.")); } });
      r.on("error", rej); w.on("error", rej); w.on("finish", res); r.pipe(w);
    });
  }

  async start() {
    const o = this.o, t0 = Date.now();
    const info = await analyze(o.input);
    if (info.problem) throw new Error(info.problem);
    const before = info.size;
    // 1) working copy
    this.work = o.input;
    if (o.output && path.resolve(o.output) !== path.resolve(o.input)) {
      this.step("copy", "run"); this.log(`Copying image to ${o.output}`);
      await this.copy(o.input, o.output); this.work = o.output; this.step("copy", "done");
    } else this.step("copy", "skip");
    this.check();
    const tbl = await (async () => { const fh = await fsp.open(this.work, "r"); try { return await readTable(fh, (await fsp.stat(this.work)).size); } finally { await fh.close(); } })();
    const part = tbl.parts.filter((p) => p.kind !== "extended").reduce((a, b) => (b.start > a.start ? b : a));
    const fh0 = await fsp.open(this.work, "r"); const ext = await readExt(fh0, part.start); await fh0.close();
    this.log(`${tbl.scheme} table · last partition #${part.num} (${part.kind}) at sector ${part.start} · ${ext.kind}, ${ext.blocks} blocks of ${ext.blockSize} bytes`);

    // 2) check filesystem
    this.step("check", "run");
    let r = await run(exe("e2fsck"), ["-pf", this.dev(part.start)], { onLine: (l) => this.log(l, "tool"), signal: this.sig });
    if (r.code > 1) {
      if (o.repair) {
        this.log("Automatic check found problems; repairing (e2fsck -fy)…", "warn");
        r = await run(exe("e2fsck"), ["-fy", this.dev(part.start)], { onLine: (l) => this.log(l, "tool"), signal: this.sig });
        if (r.code > 2) throw new Error("The filesystem has errors that could not be repaired (e2fsck exit code " + r.code + ").");
      } else throw new Error("The filesystem has errors (e2fsck exit code " + r.code + "). Turn on “Repair the filesystem if needed” and try again.");
    }
    this.step("check", "done"); this.check();

    // 3) first-boot auto expand
    if (o.autoExpand) {
      this.step("expand", "run");
      const tmp = path.join(require("os").tmpdir(), `afif-expand-${process.pid}.sh`);
      fs.writeFileSync(tmp, EXPAND_SCRIPT.replace(/\r\n/g, "\n"));
      const cat = await run(exe("afif-e2tool"), ["cat", this.dev(part.start), "/etc/rc.local"]);
      if (cat.code === 0 && /AFIF ImgShrink|do_expand_rootfs|PiShrink/.test(cat.out)) this.log("Auto-expand is already set up in this image; keeping it.");
      else {
        if (cat.code === 0) { const mv = await run(exe("afif-e2tool"), ["mv", this.dev(part.start), "/etc/rc.local", "/etc/rc.local.bak"]); if (mv.code) throw new Error("Could not back up /etc/rc.local: " + mv.err.trim()); this.log("Saved the original /etc/rc.local as /etc/rc.local.bak"); }
        else this.log("The image has no /etc/rc.local; a new one will be created.");
        const put = await run(exe("afif-e2tool"), ["put", this.dev(part.start), tmp, "/etc/rc.local", "755"]);
        if (put.code) {
          if (/target dir|error 2133571347|not found/i.test(put.err)) this.log("No /etc folder in the last partition, so auto-expand was skipped.", "warn");
          else throw new Error("Could not write the auto-expand script: " + put.err.trim());
        } else this.log("Auto-expand on first boot installed (/etc/rc.local).");
      }
      try { fs.unlinkSync(tmp); } catch {}
      this.step("expand", "done");
    } else this.step("expand", "skip");
    this.check();

    // 4) shrink filesystem
    this.step("shrink", "run");
    r = await run(exe("resize2fs"), ["-P", this.dev(part.start)], { signal: this.sig });
    const m = /minimum size of the filesystem:\s*(\d+)/i.exec(r.out + r.err);
    if (!m) throw new Error("resize2fs could not estimate the minimum size: " + (r.err || r.out).trim());
    let minBlocks = +m[1]; const cur = ext.blocks;
    this.log(`Current size ${cur} blocks · minimum ${minBlocks} blocks`);
    let newBlocks = cur;
    if (cur <= minBlocks) { this.log("The filesystem is already at its minimum size.", "warn"); }
    else {
      const extra = cur - minBlocks; for (const s of [5000, 1000, 100]) if (extra > s) { minBlocks += s; break; }
      newBlocks = Math.min(cur, minBlocks);
      let pass = 0;
      r = await run(exe("resize2fs"), ["-p", this.dev(part.start), String(newBlocks)], { signal: this.sig, onLine: (l) => {
        const pm = /Begin pass (\d)/.exec(l); if (pm) { pass = +pm[1]; this.log(l.trim(), "tool"); this.prog("shrink", (pass - 1) / 3, ["", "Allocating", "Moving blocks", "Moving inode table"][pass] || "Working"); }
        else if (/X{3,}/.test(l)) { const x = (l.match(/X/g) || []).length; this.prog("shrink", Math.min(1, (Math.max(0, pass - 1) + x / 40) / 3), ["", "Allocating", "Moving blocks", "Moving inode table"][pass] || "Working"); }
        else if (!/^-+$/.test(l.trim())) this.log(l.trim(), "tool");
      } });
      if (r.code) throw new Error("resize2fs failed (exit code " + r.code + "): " + r.err.trim() + "\nRun the tool again with “Repair the filesystem if needed” turned on.");
    }
    this.step("shrink", "done"); this.check();

    // 5) partition table + 6) truncate
    this.step("table", "run");
    const newSectors = Math.ceil((newBlocks * ext.blockSize) / SECTOR);
    const fh = await fsp.open(this.work, "r+");
    let newEnd;
    try {
      newEnd = await this.rewriteTable(fh, tbl, part, newSectors);
    } finally { await fh.close(); }
    this.step("table", "done");
    this.step("truncate", "run");
    const sizeNow = (await fsp.stat(this.work)).size;
    if (newEnd < sizeNow) { await fsp.truncate(this.work, newEnd); this.log(`Image cut from ${fmt(sizeNow)} to ${fmt(newEnd)}`); }
    this.step("truncate", "done"); this.check();

    // 7) verify
    this.step("verify", "run");
    r = await run(exe("e2fsck"), ["-fn", this.dev(part.start)], { onLine: (l) => this.log(l, "tool") });
    if (r.code > 1) throw new Error("Verification found problems in the shrunk filesystem (e2fsck exit code " + r.code + ").");
    this.step("verify", "done");
    const shrunkSize = (await fsp.stat(this.work)).size;

    // 8) compress
    let final = this.work;
    if (o.compress && o.compress !== "none") {
      this.step("compress", "run");
      final = await this.compress(this.work, o.compress, o.level);
      if (!o.keepImg && final !== this.work) { await fsp.unlink(this.work); this.log("Removed the uncompressed image (compressed copy kept)."); }
      this.step("compress", "done");
    } else this.step("compress", "skip");
    const finalSize = (await fsp.stat(final)).size;
    return { input: o.input, output: final, before, shrunk: shrunkSize, finalSize, seconds: (Date.now() - t0) / 1000, partition: part.num, blocks: { from: cur, to: newBlocks, size: ext.blockSize }, autoExpand: !!o.autoExpand };
  }

  async rewriteTable(fh, tbl, part, newSectors) {
    if (tbl.scheme === "MBR") {
      const b = Buffer.alloc(4); b.writeUInt32LE(newSectors);
      await writeAt(fh, part.entryOffset + 12, b);
      if (part.kind === "logical") { // also shrink the extended container so it ends where the logical ends
        const ext = tbl.parts.find((p) => p.kind === "extended");
        if (ext) { const end = part.start + newSectors; const c = Buffer.alloc(4); c.writeUInt32LE(end - ext.start); await writeAt(fh, ext.entryOffset + 12, c); }
      }
      this.log(`Partition #${part.num} resized to ${newSectors} sectors (${fmt(newSectors * SECTOR)})`);
      return (part.start + newSectors) * SECTOR;
    }
    // GPT: update entry, entries CRC, headers; write backup GPT at the new end of the image
    const g = tbl.gpt, entBytes = g.count * g.esz;
    const last = part.start + newSectors - 1;
    const l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(last)); await writeAt(fh, part.entryOffset + 40, l);
    const ents = await readAt(fh, g.entLba * SECTOR, entBytes);
    const entSectors = Math.ceil(entBytes / SECTOR);
    const backupHdrLba = last + entSectors + 1, backupEntLba = last + 1;
    const ecrc = crc32(ents);
    const mk = (myLba, altLba, entLba) => { const h = Buffer.from(g.header.subarray(0, 512)); const hs = h.readUInt32LE(12);
      h.writeBigUInt64LE(BigInt(myLba), 24); h.writeBigUInt64LE(BigInt(altLba), 32); h.writeBigUInt64LE(BigInt(last), 48); h.writeBigUInt64LE(BigInt(entLba), 72); h.writeUInt32LE(ecrc, 88);
      h.writeUInt32LE(0, 16); h.writeUInt32LE(crc32(h.subarray(0, hs)), 16); return h; };
    await writeAt(fh, SECTOR, mk(1, backupHdrLba, g.entLba));
    await writeAt(fh, backupEntLba * SECTOR, ents);
    await writeAt(fh, backupHdrLba * SECTOR, mk(backupHdrLba, 1, backupEntLba));
    // protective MBR covers the whole disk
    const pm = Buffer.alloc(4); pm.writeUInt32LE(Math.min(0xffffffff, backupHdrLba)); await writeAt(fh, 446 + 12, pm);
    this.log(`GPT partition #${part.num} now ends at sector ${last}; backup GPT moved to sector ${backupHdrLba}`);
    return (backupHdrLba + 1) * SECTOR;
  }

  async compress(file, kind, level) {
    const total = (await fsp.stat(file)).size;
    if (kind === "gzip") {
      const out = file + ".gz"; let done = 0, last = 0;
      await new Promise((res, rej) => {
        const r = fs.createReadStream(file, { highWaterMark: 4 << 20 }), z = zlib.createGzip({ level: level ?? 6 }), w = fs.createWriteStream(out);
        r.on("data", (c) => { done += c.length; const n = Date.now(); if (n - last > 200) { last = n; this.prog("compress", done / total, `gzip · ${fmt(done)} of ${fmt(total)}`); } if (this.cancelled) r.destroy(new Error("Cancelled.")); });
        [r, z, w].forEach((s) => s.on("error", rej)); w.on("finish", res); r.pipe(z).pipe(w);
      });
      this.log(`Compressed with gzip → ${path.basename(out)}`); return out;
    }
    if (kind === "xz") {
      const out = file + ".xz";
      try { fs.unlinkSync(out); } catch {}
      const args = ["-z", "-k", "-f", "-T0", "-v", `-${level ?? 6}`, file];
      const r = await run(exe("xz"), args, { signal: this.sig, onLine: (l) => { const pm = /(\d+(?:\.\d+)?)\s*%/.exec(l); if (pm) this.prog("compress", +pm[1] / 100, "xz · " + l.trim().replace(/\s+/g, " ").slice(0, 90)); } });
      if (r.code) throw new Error("xz failed: " + r.err.trim());
      this.log(`Compressed with xz → ${path.basename(out)}`); return out;
    }
    if (kind === "zip") {
      // zip: single-entry ZIP64 archive written by streaming deflate
      const out = file.replace(/\.img$/i, "") + ".zip";
      await zipFile(file, out, (f, t) => this.prog("compress", f, t), () => this.cancelled);
      this.log(`Compressed with ZIP → ${path.basename(out)}`); return out;
    }
    return file;
  }
}

// minimal streaming ZIP64 writer (one file, deflate)
async function zipFile(src, out, onProg, isCancelled) {
  const name = Buffer.from(path.basename(src)), st = await fsp.stat(src);
  const w = fs.createWriteStream(out); const write = (b) => new Promise((r, j) => w.write(b, (e) => (e ? j(e) : r())));
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const now = new Date(st.mtime);
  const lh = Buffer.alloc(30 + name.length + 20);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(45, 4); lh.writeUInt16LE(0x0008, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(dosTime(now), 10); lh.writeUInt16LE(dosDate(now), 12);
  lh.writeUInt32LE(0, 14); lh.writeUInt32LE(0xffffffff, 18); lh.writeUInt32LE(0xffffffff, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(20, 28); name.copy(lh, 30);
  lh.writeUInt16LE(0x0001, 30 + name.length); lh.writeUInt16LE(16, 32 + name.length); // zip64 extra with zeros (sizes in data descriptor)
  await write(lh);
  let crc = 0xffffffff, inSize = 0, outSize = 0, last = 0;
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  await new Promise((res, rej) => {
    const r = fs.createReadStream(src, { highWaterMark: 4 << 20 }), z = zlib.createDeflateRaw({ level: 6 });
    r.on("data", (c) => { for (let i = 0; i < c.length; i++) crc = table[(crc ^ c[i]) & 0xff] ^ (crc >>> 8); inSize += c.length; const n = Date.now(); if (n - last > 200) { last = n; onProg(inSize / st.size, `zip · ${fmt(inSize)} of ${fmt(st.size)}`); } if (isCancelled()) r.destroy(new Error("Cancelled.")); });
    z.on("data", (c) => { outSize += c.length; if (!w.write(c)) { z.pause(); w.once("drain", () => z.resume()); } });
    z.on("end", res); r.on("error", rej); z.on("error", rej); r.pipe(z);
  });
  crc = (crc ^ 0xffffffff) >>> 0;
  const dd = Buffer.alloc(24); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeBigUInt64LE(BigInt(outSize), 8); dd.writeBigUInt64LE(BigInt(inSize), 16); await write(dd);
  const cdOff = 30 + name.length + 20 + outSize + 24;
  const cd = Buffer.alloc(46 + name.length + 28);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(45, 4); cd.writeUInt16LE(45, 6); cd.writeUInt16LE(0x0008, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(dosTime(now), 12); cd.writeUInt16LE(dosDate(now), 14);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(0xffffffff, 20); cd.writeUInt32LE(0xffffffff, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(28, 30); cd.writeUInt32LE(0xffffffff, 42); name.copy(cd, 46);
  const x = 46 + name.length; cd.writeUInt16LE(0x0001, x); cd.writeUInt16LE(24, x + 2); cd.writeBigUInt64LE(BigInt(inSize), x + 4); cd.writeBigUInt64LE(BigInt(outSize), x + 12); cd.writeBigUInt64LE(0n, x + 20);
  await write(cd);
  const z64 = Buffer.alloc(56 + 20 + 22);
  z64.writeUInt32LE(0x06064b50, 0); z64.writeBigUInt64LE(44n, 4); z64.writeUInt16LE(45, 12); z64.writeUInt16LE(45, 14); z64.writeBigUInt64LE(1n, 24); z64.writeBigUInt64LE(1n, 32); z64.writeBigUInt64LE(BigInt(cd.length), 40); z64.writeBigUInt64LE(BigInt(cdOff), 48);
  z64.writeUInt32LE(0x07064b50, 56); z64.writeBigUInt64LE(BigInt(cdOff + cd.length), 64); z64.writeUInt32LE(1, 72);
  z64.writeUInt32LE(0x06054b50, 76); z64.writeUInt16LE(0xffff, 84); z64.writeUInt16LE(0xffff, 86); z64.writeUInt32LE(0xffffffff, 88); z64.writeUInt32LE(0xffffffff, 92);
  await write(z64);
  await new Promise((r) => w.end(r));
}

function fmt(n) { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i]; }

module.exports = { analyze, Job, fmt, setBinDir, EXPAND_SCRIPT };
