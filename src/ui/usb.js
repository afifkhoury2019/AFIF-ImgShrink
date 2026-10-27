// AFIF ImgShrink - AS USB tab: create a bootable USB drive inside the app.
// Uses the bundled afif-disk helper through the same IPC the Disk Imager uses,
// so there is no second application: everything happens in this window.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const S = window.shrink;
  const A = (window.AFIF = window.AFIF || {});
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m, e) => A.toast?.(m, e);
  const fmt = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; n = +n || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i]; };
  const fmtGB = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(0) + " MB");
  const base = (p) => String(p).split(/[\\/]/).pop();
  const st = { file: null, info: null, disks: [], sel: null, running: false, admin: true };
  const PHASE = { write: "Writing", verify: "Verifying", read: "Reading" };

  function render() {
    const btn = $("#usbGo");
    if (btn) btn.disabled = !st.file || !st.sel || st.running || !st.admin;
    const info = $("#usbFileInfo");
    if (info) info.textContent = st.info ? base(st.file) + " - " + fmt(st.info.size) : "No image chosen yet.";
    const L = $("#usbDevs");
    if (!L) return;
    if (!st.disks.length) {
      L.innerHTML = '<div class="devempty"><b>No USB drive found</b>Plug in a USB stick or card reader; it appears here automatically.</div>';
      return;
    }
    L.innerHTML = st.disks.map(function (d) {
      const on = st.sel && st.sel.id === d.id ? "on" : "";
      const letter = d.letters ? '<span class="letter">' + esc(d.letters) + "</span>" : "";
      return '<button class="dev ' + on + '" data-id="' + esc(d.id) + '"><span class="dic usb"></span>' +
        '<span class="dmeta"><b>' + letter + esc(d.name) + "</b><small>" + esc(d.busName) + " - Disk " + esc(d.n) + "</small></span>" +
        '<span class="dsize">' + fmtGB(d.size) + "</span></button>";
    }).join("");
  }

  async function refresh() {
    try {
      const r = await S.diskList(false);
      st.admin = r.admin !== false;
      st.disks = r.disks || [];
      const adminBar = $("#usbAdmin");
      if (adminBar) adminBar.classList.toggle("hidden", st.admin);
      if (st.sel && !st.disks.find(function (d) { return d.id === st.sel.id; })) st.sel = null;
      if (!st.sel && st.disks.length === 1) st.sel = st.disks[0];
    } catch (e) {
      toast(e.message, true);
    }
    render();
  }

  async function choose() {
    const f = await S.pickSource(st.file || undefined);
    if (!f) return;
    const r = await S.inspect(f);
    if (!r.ok) { toast(r.error, true); return; }
    st.file = f;
    st.info = r.info;
    $("#usbFile").value = f;
    render();
  }

  async function go() {
    if (!st.file || !st.sel || st.running) return;
    if (!st.admin) { toast("Restart as administrator to write to a USB drive.", true); return; }
    if (st.info && st.info.size > st.sel.size) { toast("The image is larger than the USB drive.", true); return; }
    st.running = true;
    render();
    $("#usbDone").classList.add("hidden");
    $("#usbRun").classList.remove("hidden");
    $("#usbBar").style.width = "0%";
    $("#usbPct").textContent = "0%";
    $("#usbStat").textContent = "Starting...";
    let r;
    try {
      r = await S.diskStart("write", { disk: st.sel, file: st.file, allocated: false, verify: $("#usbVerify").checked });
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    st.running = false;
    $("#usbRun").classList.add("hidden");
    $("#usbDone").classList.remove("hidden");
    const msg = $("#usbMsg");
    msg.textContent = r.ok ? "Done. The drive is ready to boot." : (r.error || "Writing failed.");
    msg.className = r.ok ? "saving" : "warn";
    render();
  }

  S.onDiskProgress(function (p) {
    if (!st.running) return;
    const f = p.total ? Math.min(1, p.done / p.total) : 0;
    $("#usbBar").style.width = f * 100 + "%";
    $("#usbPct").textContent = Math.floor(f * 100) + "%";
    const parts = [PHASE[p.phase] || "Working"];
    if (p.done && p.total) parts.push(fmt(p.done) + " / " + fmt(p.total));
    if (p.speed) parts.push(fmt(p.speed) + "/s");
    $("#usbStat").textContent = parts.join(" - ");
  });

  const showLog = function () { $("#log").classList.remove("hidden"); };
  $("#usbPick").onclick = choose;
  $("#usbGo").onclick = go;
  $("#usbRefresh").onclick = refresh;
  $("#usbCancel").onclick = function () { S.diskCancel(); };
  $("#usbLog").onclick = showLog;
  $("#usbLog2").onclick = showLog;
  $("#usbAgain").onclick = function () { $("#usbDone").classList.add("hidden"); };
  $("#usbDevs").onclick = function (e) {
    const b = e.target.closest(".dev");
    if (!b || st.running) return;
    st.sel = st.disks.find(function (d) { return d.id === b.dataset.id; }) || null;
    render();
  };

  A.usbEnter = refresh;
  render();
})();
