// AFIF ImgShrink — interface
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const S = window.shrink;
  const st = { info: null, out: "copy", compress: "none", running: false, result: null, logs: [] };
  const fmt = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; n = +n || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i]; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let toastT; const toast = (m, err) => { const t = $("#toast"); t.textContent = m; t.className = "on" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ""), err ? 7000 : 3500); };

  // ---------------------------------------------------------------- themes
  const THEMES = [["classic", "AFIF Classic", "#243254", "#c88636", "Navy & gold"], ["ocean", "Ocean", "#0369a1", "#e8f4fd", "Light"], ["midnight", "Midnight", "#0b1220", "#38bdf8", "Dark"], ["emerald", "Emerald", "#047857", "#ecfdf5", "Light"], ["sunset", "Sunset", "#c2410c", "#fff4e8", "Light"], ["royal", "Royal", "#6d28d9", "#a78bfa", "Dark"], ["graphite", "Graphite", "#151515", "#facc15", "Dark"]];
  const applyTheme = (t) => { document.documentElement.dataset.afif = t; };
  $("#themeBtn").onclick = (e) => {
    e.stopPropagation(); let p = $(".pop"); if (p) return p.remove();
    p = document.createElement("div"); p.className = "pop";
    p.innerHTML = THEMES.map((t) => `<button data-t="${t[0]}" class="${document.documentElement.dataset.afif === t[0] ? "on" : ""}"><span class="sw2" style="background:linear-gradient(135deg,${t[2]} 55%,${t[3]} 55%)"></span>${t[1]}<small>${t[4]}</small></button>`).join("");
    p.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; applyTheme(b.dataset.t); S.setSettings({ theme: b.dataset.t }); p.remove(); };
    document.body.appendChild(p); setTimeout(() => document.addEventListener("click", () => p.remove(), { once: true }), 0);
  };
  $("#aboutBtn").onclick = async () => {
    const i = await S.appInfo(); const b = document.createElement("div"); b.className = "modal-back";
    b.innerHTML = `<div class="modal"><div class="ab"><img src="logo.png" alt=""><div><h2>AFIF <em>ImgShrink</em></h2><p>Version ${esc(i.version)} · Windows 10/11</p><p>© ${new Date().getFullYear()} AFIF-TECH · Afif Khoury</p></div></div>
      <p style="margin-top:14px"><b>Shrink image</b>: shrinks Raspberry Pi and other Linux disk images to the smallest safe size, and can make them grow back to the full card on first boot.</p><p><b>Disk Imager</b>: reads SD cards and USB drives to .img files, writes .img / .zip / .xz / .gz images to cards, verifies them and calculates MD5, SHA-1 and SHA-256 hashes.</p>
      <p style="font-size:12px">Uses e2fsprogs (e2fsck, resize2fs; GPL-2.0, © Theodore Ts'o and contributors) built for Windows, and xz (0BSD). Source code of these tools is included with the application's licences.</p>
      <div style="text-align:right;margin-top:12px"><button class="btn primary">Close</button></div></div>`;
    b.onclick = (e) => { if (e.target === b || e.target.closest("button")) b.remove(); }; document.body.appendChild(b);
  };

  // ---------------------------------------------------------------- loading an image
  async function load(file) {
    if (st.running) return toast("Please wait until the current image is finished.", true);
    if (!file) return;
    toast("Reading " + file.split(/[\\/]/).pop() + "…");
    const r = await S.analyze(file);
    if (!r.ok) { toast(r.error, true); return; }
    st.info = r.info; $("#toast").className = ""; render(); S.setSettings({ lastDir: file.replace(/[\\/][^\\/]*$/, "") });
  }
  function render() {
    const i = st.info;
    $("#drop").classList.toggle("hidden", !!i); $("#imgCard").classList.toggle("hidden", !i);
    $("#run").classList.add("hidden"); $("#done").classList.add("hidden"); $("#opts").classList.remove("hidden");
    if (!i) { $("#start").disabled = true; return; }
    const name = i.file.split(/[\\/]/).pop();
    $("#fName").textContent = name; $("#fPath").textContent = i.file;
    const parts = i.parts.filter((p) => p.kind !== "extended").sort((a, b) => a.start - b.start), total = i.size;
    let html = "", pos = 0;
    const pct = (b) => Math.max(0.4, (b / total) * 100);
    for (const p of parts) {
      const s = p.start * 512; if (s - pos > total * 0.004) html += `<div class="seg gap" style="width:${pct(s - pos)}%"></div>`;
      const isLast = p.num === i.last, w = pct(p.bytes);
      if (isLast && p.fs) { const used = Math.min(100, (p.fs.usedBlocks / p.fs.blocks) * 100); html += `<div class="seg root" style="width:${w}%" title="${esc(p.fs.kind)} · ${fmt(p.fs.usedBlocks * p.fs.blockSize)} used of ${fmt(p.bytes)}"><div class="used" style="width:${used}%"></div><span>${esc(p.fs.label || "rootfs")} · ${Math.round(used)}% used</span></div>`; }
      else html += `<div class="seg ${/FAT|EFI/i.test(p.fsLabel || p.name) ? "boot" : "other"}" style="width:${w}%" title="${esc(p.fsLabel || p.name)}">${w > 6 ? esc(p.fsLabel || p.name) : ""}</div>`;
      pos = s + p.bytes;
    }
    if (total - pos > total * 0.004) html += `<div class="seg gap" style="width:${pct(total - pos)}%">unused</div>`;
    $("#pbar").innerHTML = html;
    $("#pLegend").innerHTML = `<span><i style="background:#2b5f99"></i>Boot / other</span><span><i style="background:#c88636"></i>Root data in use</span><span><i style="background:color-mix(in srgb,#c88636 25%,#fff)"></i>Root free space (removed)</span>`;
    $("#sSize").textContent = fmt(i.size);
    $("#sUsed").textContent = i.used ? fmt(i.used) : "—";
    $("#sEst").textContent = i.estimate ? "≈ " + fmt(i.estimate) : "—";
    $("#sSave").textContent = i.estimate ? "≈ " + Math.max(0, Math.round((1 - i.estimate / i.size) * 100)) + "%" : "—";
    $("#parts").innerHTML = `<tr><th>#</th><th>Type</th><th>Filesystem</th><th>Start</th><th>Size</th><th></th></tr>` + parts.map((p) =>
      `<tr class="${p.num === i.last ? "last" : ""}"><td>${p.num}</td><td>${esc(p.name)}${p.kind === "logical" ? " (logical)" : ""}</td><td>${p.fs ? esc(p.fs.kind + (p.fs.label ? " · " + p.fs.label : "")) : esc(p.fsLabel || "—")}</td><td>${fmt(p.start * 512)}</td><td>${fmt(p.bytes)}</td><td>${p.num === i.last && p.fs ? '<span class="badge ok">will be shrunk</span>' : ""}</td></tr>`).join("") +
      `<tr><td colspan="6" style="color:var(--k-soft)">${esc(i.scheme)} partition table${i.diskSig ? " · disk ID " + esc(i.diskSig) : ""}</td></tr>`;
    $("#problem").classList.toggle("hidden", !i.problem); $("#problem").textContent = i.problem || "";
    $("#start").disabled = !!i.problem;
    $("#outPath").value = i.file.replace(/(\.img)?$/i, "-shrunk.img").replace(/\.img-shrunk\.img$/i, "-shrunk.img");
    setOut(st.out);
  }
  $("#pick").onclick = async () => load(await S.pickImage());
  $("#change").onclick = async () => load(await S.pickImage());
  $("#drop").onclick = (e) => { if (!e.target.closest("button")) $("#pick").click(); };
  let dd = 0;
  window.addEventListener("dragenter", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dd++; document.body.classList.add("dragging"); } });
  window.addEventListener("dragleave", () => { if (--dd <= 0) { dd = 0; document.body.classList.remove("dragging"); } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => { e.preventDefault(); dd = 0; document.body.classList.remove("dragging"); const f = e.dataTransfer.files[0]; if (f) { const p = S.pathForFile(f); if (document.body.dataset.tab === "imager") window.AFIF.imagerFile(p); else { window.AFIF.tab?.("shrink"); load(p); } } });
  S.onOpenFile(load);

  // ---------------------------------------------------------------- options
  function setOut(v) {
    st.out = v; $$("#outMode button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    $("#outRow").classList.toggle("hidden", v !== "copy");
    $("#outHint").innerHTML = v === "copy" ? "The original image is not changed. You need free space for the copy." : "<b style='color:var(--k-warn)'>The original file is changed directly.</b> Fastest and needs no extra space. Keep a backup if the image is important.";
  }
  $("#outMode").onclick = (e) => { const b = e.target.closest("button"); if (b) { setOut(b.dataset.v); S.setSettings({ out: b.dataset.v }); } };
  $("#outPick").onclick = async () => { const p = await S.pickOutput($("#outPath").value); if (p) $("#outPath").value = p; };
  $("#cmp").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.compress = b.dataset.v; $$("#cmp button").forEach((x) => x.classList.toggle("on", x === b)); $("#lvlRow").hidden = st.compress === "none"; S.setSettings({ compress: st.compress }); };
  $("#lvl").oninput = () => ($("#lvlOut").textContent = $("#lvl").value);
  ["optExpand", "optRepair", "keepImg"].forEach((id) => $("#" + id).addEventListener("change", () => S.setSettings({ [id]: $("#" + id).checked })));

  // ---------------------------------------------------------------- running
  const STEPS = [["copy", "Copy image"], ["check", "Check filesystem"], ["expand", "Set up auto-expand"], ["shrink", "Shrink filesystem"], ["table", "Update partition table"], ["truncate", "Cut image file"], ["verify", "Verify"], ["compress", "Compress"]];
  const WEIGHT = { copy: 22, check: 8, expand: 2, shrink: 30, table: 1, truncate: 1, verify: 6, compress: 30 };
  let stepState = {}, cur = null, sub = 0;
  function setGauge() {
    const active = STEPS.filter(([id]) => stepState[id] !== "skip"); const tot = active.reduce((s, [id]) => s + WEIGHT[id], 0);
    let done = 0; for (const [id] of active) { if (stepState[id] === "done") done += WEIGHT[id]; else if (stepState[id] === "run") done += WEIGHT[id] * sub; }
    const f = Math.min(1, done / (tot || 1)); $("#gFg").style.strokeDashoffset = 527.8 * (1 - f); $("#gPct").textContent = Math.round(f * 100) + "%"; S.taskbar(f);
  }
  function renderSteps() { $("#steps").innerHTML = STEPS.map(([id, n]) => `<li class="${stepState[id] || ""}" data-id="${id}"><i></i>${n}</li>`).join(""); }
  function log(m, k) { st.logs.push({ m, k }); const pre = $("#logPre"); const span = document.createElement("span"); span.className = k === "warn" ? "w" : k === "error" ? "e" : k === "tool" ? "t" : ""; span.textContent = m + "\n"; pre.appendChild(span); pre.scrollTop = pre.scrollHeight; }
  S.onLog((d) => log(d.msg, d.kind));
  S.onStep((d) => { stepState[d.id] = d.state; if (d.state === "run") { cur = d.id; sub = 0; $("#gStep").textContent = STEPS.find((s) => s[0] === d.id)[1] + "…"; $("#subBar").style.width = "0"; $("#subTxt").textContent = ""; } renderSteps(); setGauge(); });
  S.onProgress((d) => { if (d.id !== cur) return; sub = Math.max(0, Math.min(1, d.frac)); $("#subBar").style.width = sub * 100 + "%"; $("#subTxt").textContent = d.text || ""; setGauge(); });

  $("#start").onclick = async () => {
    const i = st.info; if (!i || st.running) return;
    const output = st.out === "copy" ? $("#outPath").value.trim() : null;
    if (st.out === "copy") {
      if (!output) return toast("Choose where to save the shrunk image.", true);
      if (output.toLowerCase() === i.file.toLowerCase()) return toast("The new file must have a different name, or choose “Shrink the original”.", true);
      if (await S.exists(output) && !confirm(`${output}\n\nalready exists. Replace it?`)) return;
      const free = await S.freeSpace(output.replace(/[\\/][^\\/]*$/, "") || ".");
      if (free != null && free < i.size * 1.02) return toast(`Not enough free space for the copy: ${fmt(i.size)} needed, ${fmt(free)} free. Choose another drive or “Shrink the original”.`, true);
    } else if (!confirm("The original image file will be changed directly.\n\nContinue?")) return;
    if (/[\\/]OneDrive[^\\/]*[\\/]/i.test(output || i.file) && !confirm("The working image is inside a OneDrive folder.\n\nOneDrive may start uploading or lock the file while it is being shrunk, which can make the job fail. For best results, save to a folder outside OneDrive (for example C:\\Images) or pause OneDrive syncing first.\n\nContinue anyway?")) return;
    st.running = true; stepState = {}; st.logs = []; $("#logPre").textContent = ""; renderSteps(); setGauge();
    $("#opts").classList.add("hidden"); $("#run").classList.remove("hidden"); $("#done").classList.add("hidden"); $("#change").disabled = true;
    log(`AFIF ImgShrink · ${new Date().toLocaleString()}`); log(`Input: ${i.file}`); if (output) log(`Output: ${output}`);
    const r = await S.start({ input: i.file, output, autoExpand: $("#optExpand").checked, repair: $("#optRepair").checked, compress: st.compress, level: +$("#lvl").value, keepImg: $("#keepImg").checked });
    st.running = false; $("#change").disabled = false; S.taskbar(null);
    if (!r.ok) {
      if (cur) { stepState[cur] = "fail"; renderSteps(); }
      log("ERROR: " + r.error, "error"); $("#gStep").textContent = "Stopped"; toast(r.error, true);
      $("#cancel").textContent = "Back"; $("#cancel").onclick = () => { $("#cancel").textContent = "Cancel"; $("#cancel").onclick = cancel; render(); };
      return;
    }
    st.result = r.result; showDone(r.result);
  };
  const cancel = async () => { if (st.running && confirm("Stop shrinking? If you chose “Shrink the original”, the image may be left unusable.")) S.cancel(); };
  $("#cancel").onclick = cancel;
  function showDone(r) {
    $("#run").classList.add("hidden"); $("#done").classList.remove("hidden");
    const after = r.finalSize, saved = r.before - after;
    $("#dTitle").textContent = r.blocks.from === r.blocks.to ? "Image trimmed (filesystem was already minimal)" : "Image shrunk";
    $("#vBefore").textContent = fmt(r.before); $("#vAfter").textContent = fmt(after);
    $("#bBefore").style.width = "0"; $("#bAfter").style.width = "0";
    requestAnimationFrame(() => setTimeout(() => { $("#bBefore").style.width = "100%"; $("#bAfter").style.width = Math.max(1.5, (after / r.before) * 100) + "%"; }, 60));
    $("#dSave").textContent = `${fmt(saved)} smaller · −${Math.round((saved / r.before) * 100)}% · ${r.seconds < 60 ? Math.round(r.seconds) + " s" : Math.round(r.seconds / 60) + " min"}`;
    $("#dFile").innerHTML = esc(r.output) + (r.autoExpand ? "<br>Auto-expand is set up: the root partition will grow to fill the card on first boot." : "");
    log(`Done: ${fmt(r.before)} → ${fmt(after)} (${r.output})`);
  }
  $("#openFolder").onclick = () => st.result && S.showItem(st.result.output);
  $("#toCard").onclick = () => st.result && window.AFIF.toCard(st.result.output);
  const usbBtn = $("#usbOpen");
  if (usbBtn) usbBtn.onclick = async () => {
    usbBtn.disabled = true;
    try { const r = await S.launchUsb(); if (!r || !r.ok) toast(r?.error || "AS USB Writer could not be started.", true); }
    finally { setTimeout(() => { usbBtn.disabled = false; }, 800); }
  };
  $("#again").onclick = () => { st.info = null; st.result = null; $("#outPath").value = ""; render(); };
  const showLog = () => $("#log").classList.remove("hidden");
  $("#logBtn").onclick = showLog; $("#logBtn2").onclick = showLog; $("#logClose").onclick = () => $("#log").classList.add("hidden");
  $("#logCopy").onclick = () => { navigator.clipboard.writeText($("#logPre").textContent); toast("Log copied."); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#log").classList.add("hidden"); $(".pop")?.remove(); $(".modal-back")?.remove(); } if (e.ctrlKey && e.key.toLowerCase() === "o") { e.preventDefault(); $("#pick").click(); } });

  // ---------------------------------------------------------------- start-up
  (async () => {
    const s = await S.settings();
    applyTheme(s.theme || "classic");
    if (s.out) setOut(s.out);
    if (s.compress) { st.compress = s.compress; $$("#cmp button").forEach((x) => x.classList.toggle("on", x.dataset.v === s.compress)); $("#lvlRow").hidden = s.compress === "none"; }
    ["optExpand", "optRepair", "keepImg"].forEach((id) => { if (s[id] != null) $("#" + id).checked = s[id]; });
    renderSteps();
    const p = await S.pendingFiles(); if (p[0]) load(p[0]);
    if ((await S.startTab()) === "imager") window.AFIF.tab?.("imager");
    window.AFIF = Object.assign(window.AFIF || {}, { load, toast, fmt, esc, st, running: () => st.running });
    window.AFIF.ready?.();
  })();
})();
