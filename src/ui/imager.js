// AFIF ImgShrink — Disk Imager tab (read / write / verify SD cards and USB drives, hashes). © AFIF-TECH · Afif Khoury.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const S = window.shrink;
  const A = (window.AFIF = window.AFIF || {});
  const fmt = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; n = +n || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i]; };
  const fmtGB = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(0) + " MB"); // card sizes as printed on the label
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m, e) => A.toast?.(m, e);
  const dur = (s) => (s == null || !isFinite(s) ? "—" : s < 60 ? Math.ceil(s) + " s" : s < 3600 ? Math.floor(s / 60) + " min " + String(Math.round(s % 60)).padStart(2, "0") + " s" : (s / 3600).toFixed(1) + " h");
  const st = { tab: "shrink", disks: [], sel: null, admin: true, src: null, running: false, last: null, poll: null, hashAlgo: "sha256" };

  // ---------------------------------------------------------------- tabs
  A.tab = (t) => {
    if (st.running || A.running?.()) { if (t !== st.tab) toast("Please wait until the current job is finished.", true); return; }
    st.tab = t; document.body.dataset.tab = t;
    $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    $("#main").classList.toggle("hidden", t !== "shrink"); $("#imager").classList.toggle("hidden", t !== "imager"); $("#usb").classList.toggle("hidden", t !== "usb");
    $("#dropShade div").textContent = t === "imager" ? "Drop the image file here" : "Drop the image to load it";
    clearInterval(st.poll);
    if (t === "imager") { refresh(); st.poll = setInterval(() => !st.running && refresh(true), 3000); }
    S.setSettings({ tab: t });
  };
  $("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) A.tab(b.dataset.tab); };

  // ---------------------------------------------------------------- devices
  async function refresh(quiet) {
    const r = await S.diskList($("#showAll").checked);
    st.admin = r.admin; $("#adminBar").classList.toggle("hidden", r.admin || !!r.error);
    const sig = JSON.stringify(r.disks.map((d) => [d.id, d.size, d.letters, d.media]));
    if (quiet && sig === st.sig) return; st.sig = sig;
    st.disks = r.disks;
    if (st.sel && !st.disks.find((d) => d.id === st.sel.id)) { if (quiet) toast(`${st.sel.name} was removed.`); st.sel = null; }
    if (!st.sel && st.disks.length === 1) st.sel = st.disks[0];
    if (st.sel) st.sel = st.disks.find((d) => d.id === st.sel.id);
    const L = $("#devList");
    if (r.error) L.innerHTML = `<div class="devempty"><b>Disk access unavailable</b>${esc(r.error)}</div>`;
    else if (!st.disks.length) L.innerHTML = `<div class="devempty"><b>No SD card or USB drive found</b>Insert a card or USB stick; it will appear here automatically.${r.hidden ? `<br><small>${r.hidden} other disk(s) hidden. Tick “Show all disks” to see them.</small>` : ""}</div>`;
    else L.innerHTML = st.disks.map((d) => `<button class="dev ${st.sel?.id === d.id ? "on" : ""} ${d.media === false ? "" : ""}" data-id="${esc(d.id)}">
      <span class="dic ${d.bus === 7 && !d.removable ? "usb" : d.bus === 7 && /flash|usb|stick|cruzer|ultra|datatraveler/i.test(d.name) ? "usb" : ""}"></span>
      <span class="dmeta"><b>${d.letters ? d.letters.split(" ").map((l) => `<span class="letter">${esc(l)}</span>`).join("") : ""}${esc(d.name)}</b>
      <small>${esc(d.busName)} · Disk ${esc(d.n)}${d.serial ? " · S/N " + esc(d.serial) : ""}</small></span>
      <span class="dsize">${fmtGB(d.size)}</span></button>`).join("");
    updateActs();
  }
  $("#devList").onclick = (e) => { const b = e.target.closest(".dev"); if (!b || st.running) return; st.sel = st.disks.find((d) => d.id === b.dataset.id); $$(".dev").forEach((x) => x.classList.toggle("on", x === b)); updateActs(); };
  $("#dRefresh").onclick = () => { st.sig = null; refresh(); };
  $("#showAll").onchange = () => {
    if ($("#showAll").checked && !confirm("Show every disk, including internal and external hard drives?\n\nWriting an image erases the whole disk. Your Windows disk stays hidden, but please double-check the drive letter before writing.")) { $("#showAll").checked = false; return; }
    st.sig = null; refresh();
  };
  $("#elevate").onclick = async () => { const r = await S.relaunchAdmin(); if (!r.ok) toast(r.error, true); };

  // ---------------------------------------------------------------- image file
  async function setFile(p, quiet) {
    $("#iFile").value = p || ""; st.src = null; $("#hOut").value = "";
    if (!p) return updateActs();
    if (await S.exists(p)) {
      const r = await S.inspect(p);
      if (r.ok) { st.src = r.info; const i = r.info;
        $("#iInfo").innerHTML = `<b>${esc(p.split(/[\\/]/).pop())}</b> · ${i.kind === "img" ? fmt(i.size) + " image" : `${i.kind.toUpperCase()} file ${fmt(i.fileSize)}${i.size ? " → " + fmt(i.size) + " image" : ""}${i.inner ? " (" + esc(i.inner) + ")" : ""}, written directly`}`;
      } else { $("#iInfo").textContent = r.error; if (!quiet) toast(r.error, true); }
    } else $("#iInfo").innerHTML = `New file: a card image will be saved here when you click <b>Read</b>.`;
    S.setSettings({ imagerFile: p });
    updateActs();
  }
  A.imagerFile = (p) => { A.tab("imager"); setFile(p); };
  A.toCard = (p) => { A.tab("imager"); setFile(p); toast("Choose the SD card, then click Write."); };
  $("#iFile").onchange = () => setFile($("#iFile").value.trim());
  $("#iOpen").onclick = async () => { const p = await S.pickSource($("#iFile").value || undefined); if (p) setFile(p); };
  $("#iSave").onclick = async () => {
    const d = st.sel; const def = $("#iFile").value && !st.src ? $("#iFile").value : (d ? `${(d.name || "card").replace(/[^\w.-]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.img` : "card.img");
    const p = await S.pickSaveImg(def); if (p) setFile(p);
  };

  function updateActs() {
    const d = st.sel, f = $("#iFile").value.trim(), src = st.src;
    const busy = st.running;
    $("#aRead").disabled = busy || !d || !f || (src && src.kind !== "img");
    $("#aWrite").disabled = busy || !d || !src;
    $("#aVerify").disabled = busy || !d || !src;
    let h = "";
    if (!d) h = "Select a device.";
    else if (!f) h = "Choose an image file to write, or “Save as…” to read the card into a new file.";
    else if (src && d && src.size > d.size) h = `<span style="color:var(--k-red)">This image (${fmt(src.size)}) is larger than the selected device (${fmt(d.size)}). Shrink it first.</span>`;
    else if (src) h = `Write <b>${esc(f.split(/[\\/]/).pop())}</b> to <b>${esc(d.letters || "")} ${esc(d.name)}</b>, or read the card over it.`;
    else h = `Read <b>${esc(d.letters || "")} ${esc(d.name)}</b> into <b>${esc(f.split(/[\\/]/).pop())}</b>.`;
    $("#actHint").innerHTML = h;
    $("#hGen").disabled = !src || busy;
  }

  // ---------------------------------------------------------------- hashing
  $("#hAlgo").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.hashAlgo = b.dataset.v; $$("#hAlgo button").forEach((x) => x.classList.toggle("on", x === b)); $("#hOut").value = ""; };
  S.onHashProgress((f) => ($("#hBar i").style.width = f * 100 + "%"));
  $("#hGen").onclick = async () => {
    const f = $("#iFile").value.trim(); if (!f) return;
    $("#hGen").disabled = true; $("#hBar").classList.remove("hidden"); $("#hBar i").style.width = "0"; $("#hOut").value = "Calculating " + st.hashAlgo.toUpperCase() + "…";
    const r = await S.hash(f, st.hashAlgo);
    $("#hBar").classList.add("hidden"); $("#hGen").disabled = false;
    $("#hOut").value = r.ok ? r.hash : ""; if (!r.ok) toast(r.error, true);
  };
  $("#hCopy").onclick = () => { if ($("#hOut").value) { navigator.clipboard.writeText($("#hOut").value); toast("Hash copied."); } };

  // ---------------------------------------------------------------- confirm dialog
  function ask(title, html, okText, danger) {
    return new Promise((res) => {
      const b = document.createElement("div"); b.className = "modal-back";
      b.innerHTML = `<div class="modal"><h3>${title}</h3>${html}<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn" data-r="0">Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-r="1">${okText}</button></div></div>`;
      b.onclick = (e) => { const x = e.target.closest("button[data-r]"); if (x || e.target === b) { b.remove(); res(x?.dataset.r === "1"); } };
      document.body.appendChild(b); b.querySelector("[data-r='0']").focus();
    });
  }
  const devHtml = (d) => `<b>${esc(d.letters || "")} ${esc(d.name)}</b> · ${fmtGB(d.size)} · ${esc(d.busName)} · Disk ${esc(d.n)}`;

  // ---------------------------------------------------------------- run
  const PHASE = { read: "Reading the card", write: "Writing the card", verify: "Verifying" };
  S.onDiskProgress((p) => {
    if (!st.running) return;
    const f = p.total ? Math.min(1, p.done / p.total) : 0;
    $("#rTitle").textContent = PHASE[p.phase] + "…";
    $("#rBar").style.width = f * 100 + "%"; $("#rPct").textContent = Math.floor(f * 100) + "%";
    $("#rDone").textContent = `${fmt(p.done)} / ${fmt(p.total)}`;
    $("#rSpeed").textContent = p.speed ? fmt(p.speed) + "/s" : "—";
    $("#rEta").textContent = dur(p.eta);
  });

  async function go(op) {
    const d = st.sel, file = $("#iFile").value.trim(); if (!d || !file) return;
    if (!st.admin) { toast("Restart as administrator to access the card.", true); return; }
    if (op === "read") {
      if (st.src && !(await ask("Replace the image file?", `<p><b>${esc(file)}</b> already exists and will be overwritten with the contents of ${devHtml(d)}.</p>`, "Replace"))) return;
      const free = await S.freeSpace(file.replace(/[\\/][^\\/]*$/, "") || ".");
      if (free != null && !$("#optAlloc").checked && free < d.size) { toast(`Not enough free space: the card is ${fmt(d.size)}, the drive has ${fmt(free)} free. Turn on “Read only allocated partitions” or choose another drive.`, true); return; }
    }
    if (op === "write") {
      if (st.src.size > d.size) { toast("The image is larger than the device.", true); return; }
      if (!(await ask("Write to this device?", `<p>${devHtml(d)}</p><div class="dz">Everything on this device will be erased and replaced by<br>${esc(file.split(/[\\/]/).pop())}.</div><p class="hint">Close any Explorer windows showing the card. Windows may ask to format the card afterwards: click <b>Cancel</b>.</p>`, "Erase and write", true))) return;
    }
    st.running = true; updateActs();
    $("#logPre").textContent = "";
    $("#iOpts").classList.add("hidden"); $("#iDone").classList.add("hidden"); $("#iRun").classList.remove("hidden");
    $("#rTitle").textContent = PHASE[op] + "…"; $("#rSub").innerHTML = op === "read" ? `${devHtml(d)} → ${esc(file)}` : `${esc(file)} → ${devHtml(d)}`;
    $("#rBar").style.width = "0"; $("#rPct").textContent = "0%"; ["#rDone", "#rSpeed", "#rEta"].forEach((x) => ($(x).textContent = "—"));
    const r = await S.diskStart(op, { disk: d, file, allocated: $("#optAlloc").checked, verify: $("#optVerify").checked });
    st.running = false; st.last = r.ok ? r.result : null;
    $("#iRun").classList.add("hidden"); $("#iDone").classList.remove("hidden");
    $("#iTrophy").className = "trophy" + (r.ok ? "" : " bad"); $("#iTrophy").textContent = r.ok ? "✓" : "!";
    if (r.ok) {
      const x = r.result;
      $("#iTitle").textContent = op === "read" ? "Card image saved" : op === "write" ? (x.verified ? "Written and verified" : "Write successful") : "Verify successful";
      $("#iSave2").textContent = `${fmt(x.bytes)} · ${dur(x.seconds)} · ${fmt(x.bytes / Math.max(x.seconds, 0.1))}/s`;
      $("#iDetail").innerHTML = op === "read" ? esc(x.file) + "<br>Tip: shrink it to make it small enough to share or archive." : op === "write" ? `${esc(file.split(/[\\/]/).pop())} is on ${esc(d.letters || "")} ${esc(d.name)}. You can remove the card safely.` : "The device matches the image byte for byte.";
      $("#iShrink").classList.toggle("hidden", op !== "read"); $("#iFolder").classList.toggle("hidden", op !== "read");
      if (op === "read") setFile(file, true);
    } else {
      $("#iTitle").textContent = r.error === "Cancelled." ? "Cancelled" : op === "verify" || /Verification failed/.test(r.error) ? "Verification failed" : "Something went wrong";
      $("#iSave2").textContent = ""; $("#iDetail").textContent = r.error + (op === "write" && r.error === "Cancelled." ? " The card was only partly written; write it again before using it." : "");
      $("#iShrink").classList.add("hidden"); $("#iFolder").classList.add("hidden");
    }
    updateActs(); st.sig = null;
  }
  $("#aRead").onclick = () => go("read"); $("#aWrite").onclick = () => go("write"); $("#aVerify").onclick = () => go("verify");
  $("#rCancel").onclick = async () => { if (await ask("Stop now?", st.last?.op === "write" || /Writing/.test($("#rTitle").textContent) ? "<p>The card will be left only partly written and won't start until it's written again.</p>" : "<p>The job will stop.</p>", "Stop", true)) S.diskCancel(); };
  const showLog = () => $("#log").classList.remove("hidden");
  $("#rLog").onclick = showLog; $("#iLog").onclick = showLog;
  $("#iBack").onclick = () => { $("#iDone").classList.add("hidden"); $("#iOpts").classList.remove("hidden"); refresh(); };
  $("#iFolder").onclick = () => st.last && S.showItem(st.last.file);
  $("#iShrink").onclick = () => { const f = st.last?.file; if (!f) return; $("#iBack").click(); A.tab("shrink"); A.load(f); };

  // ---------------------------------------------------------------- start-up
  A.ready = async () => {
    const s = await S.settings();
    if (s.imagerFile) setFile(s.imagerFile, true);
    if (s.tab === "imager" && !document.body.dataset.tab) A.tab("imager"); else if (!document.body.dataset.tab) document.body.dataset.tab = "shrink";
  };
})();
