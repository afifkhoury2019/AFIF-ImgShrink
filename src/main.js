// AFIF ImgShrink — main process. © AFIF-TECH (Afif Khoury).
"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const engine = require("./engine");
const disk = require("./disk");
const { spawn } = require("child_process");

if (app.isPackaged) { engine.setBinDir(path.join(process.resourcesPath, "bin")); disk.setBinDir(path.join(process.resourcesPath, "bin")); }
let djob = null;
let win = null, job = null;
const pending = process.argv.slice(1).filter((a) => /\.img$/i.test(a) && fs.existsSync(a));
const SET = () => path.join(app.getPath("userData"), "settings.json");
const readS = () => { try { return JSON.parse(fs.readFileSync(SET(), "utf8")); } catch { return {}; } };
const writeS = (s) => { try { fs.mkdirSync(path.dirname(SET()), { recursive: true }); fs.writeFileSync(SET(), JSON.stringify(s, null, 1)); } catch {} };

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => { const f = argv.slice(1).find((a) => /\.img$/i.test(a)); if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) win.webContents.send("open-file", f); } });

function create() {
  const s = readS();
  win = new BrowserWindow({
    width: s.w || 1280, height: s.h || 820, minWidth: 980, minHeight: 680, show: false, backgroundColor: "#141c30", title: "AFIF ImgShrink",
    icon: path.join(__dirname, "build", "icon.png"), titleBarStyle: "hidden", titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: 44 },
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.once("ready-to-show", () => win.show());
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 4000);
  win.on("close", (e) => {
    const b = win.getBounds(); writeS({ ...readS(), w: b.width, h: b.height });
    if ((job && !job.finished) || (djob && !djob.finished)) {
      const c = dialog.showMessageBoxSync(win, { type: "warning", buttons: ["Keep working", "Stop and close"], defaultId: 0, cancelId: 0, title: "AFIF ImgShrink", message: djob && !djob.finished ? "A disk is being read or written." : "An image is being shrunk.", detail: "Stopping now can leave the working image unusable. Only close if you are working on a copy." });
      if (c === 0) e.preventDefault(); else { job?.cancel(); djob?.cancel(); }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
}
app.whenReady().then(create);
app.on("window-all-closed", () => app.quit());

const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
ipcMain.handle("pending-files", () => pending.splice(0));
ipcMain.handle("pick-image", async () => { const r = await dialog.showOpenDialog(win, { title: "Choose a disk image", properties: ["openFile"], filters: [{ name: "Disk images", extensions: ["img", "bin", "raw"] }, { name: "All files", extensions: ["*"] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("pick-output", async (_e, def) => { const r = await dialog.showSaveDialog(win, { title: "Save the shrunk image as", defaultPath: def, filters: [{ name: "Disk image", extensions: ["img"] }] }); return r.canceled ? null : r.filePath; });
ipcMain.handle("analyze", async (_e, file) => { try { return { ok: true, info: await engine.analyze(file) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("free-space", async (_e, dir) => { try { const s = await fs.promises.statfs(dir); return s.bavail * s.bsize; } catch { return null; } });
ipcMain.handle("exists", (_e, p) => fs.existsSync(p));
ipcMain.handle("start", async (_e, opts) => {
  if (job && !job.finished) return { ok: false, error: "A job is already running." };
  job = new engine.Job(opts);
  job.on("log", (d) => send("job-log", d)); job.on("step", (d) => send("job-step", d)); job.on("progress", (d) => send("job-progress", d));
  win.setProgressBar(2);
  try { const r = await job.start(); job.finished = true; win.setProgressBar(-1); if (!win.isFocused()) win.flashFrame(true); return { ok: true, result: r }; }
  catch (e) { job.finished = true; win.setProgressBar(-1); return { ok: false, error: e.message }; }
});
ipcMain.handle("cancel", () => { job?.cancel(); return true; });
ipcMain.handle("show-item", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("open-url", (_e, u) => { if (/^https?:/.test(u)) shell.openExternal(u); });
ipcMain.handle("settings", () => readS());
ipcMain.handle("set-settings", (_e, p) => { const s = { ...readS(), ...p }; writeS(s); return s; });
ipcMain.handle("app-info", () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform }));
ipcMain.handle("taskbar", (_e, f) => { if (win) win.setProgressBar(f == null ? -1 : f); });
ipcMain.handle("expand-script", () => engine.EXPAND_SCRIPT);

// ---------------------------------------------------------------- Disk Imager
ipcMain.handle("start-tab", () => (process.argv.includes("--imager") ? "imager" : "shrink"));
ipcMain.handle("disk-list", (_e, all) => disk.listDisks(all));
ipcMain.handle("pick-source", async (_e, def) => { const r = await dialog.showOpenDialog(win, { title: "Choose an image to write", defaultPath: def || undefined, properties: ["openFile"], filters: [{ name: "Disk images", extensions: ["img", "zip", "xz", "gz", "bin", "raw", "iso"] }, { name: "All files", extensions: ["*"] }] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle("pick-save-img", async (_e, def) => { const r = await dialog.showSaveDialog(win, { title: "Save the card image as", defaultPath: def, filters: [{ name: "Disk image", extensions: ["img"] }] }); return r.canceled ? null : r.filePath; });
ipcMain.handle("inspect", async (_e, f) => { try { return { ok: true, info: await disk.inspect(f) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("disk-start", async (_e, op, opts) => {
  if ((djob && !djob.finished) || (job && !job.finished)) return { ok: false, error: "Another job is already running." };
  djob = new disk.DiskJob(op, opts);
  djob.on("log", (d) => send("job-log", d)); djob.on("progress", (d) => { send("disk-progress", d); if (win && d.total) win.setProgressBar(d.done / d.total); });
  try { const r = await djob.start(); djob.finished = true; win.setProgressBar(-1); if (!win.isFocused()) win.flashFrame(true); return { ok: true, result: r }; }
  catch (e) { djob.finished = true; win.setProgressBar(-1); return { ok: false, error: e.message }; }
});
ipcMain.handle("disk-cancel", () => { djob?.cancel(); return true; });
let hashCancel = false;
ipcMain.handle("hash", async (_e, file, algo) => { hashCancel = false; try { return { ok: true, hash: await disk.hashFile(file, algo, (f) => send("hash-progress", f), () => hashCancel) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle("hash-cancel", () => { hashCancel = true; });
ipcMain.handle("relaunch-admin", async () => {
  if (process.platform !== "win32") return { ok: false, error: "Only needed on Windows." };
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const args = app.isPackaged ? "'--imager'" : q('"' + app.getAppPath() + '" --imager');
  app.releaseSingleInstanceLock();
  const code = await new Promise((res) => { const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", `Start-Process -FilePath ${q(process.execPath)} -ArgumentList ${args} -Verb RunAs`], { windowsHide: true, stdio: "ignore" }); p.on("close", res); p.on("error", () => res(1)); });
  if (code === 0) { setTimeout(() => app.exit(0), 300); return { ok: true }; }
  app.requestSingleInstanceLock();
  return { ok: false, error: "Administrator rights were not granted." };
});
