// AFIF ImgShrink - AS USB tab.
// Layout mirrors Rufus 4.15's main window control-for-control:
//   Drive Properties : Device, Boot selection (+SELECT, hash), Partition scheme,
//                      Target system, advanced drive properties
//   Format Options   : Volume label, File system, Cluster size, advanced format
//                      options (quick format, extended label/icon, bad blocks,
//                      UEFI media validation)
//   Status           : READY / progress, START, CLOSE, device count
// Writing goes through the shared afif-disk engine (disk-start), the same path
// the Disk Imager tab uses. No external program is started.
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const S = window.shrink;
  const A = (window.AFIF = window.AFIF || {});
  const toast = (m, e) => A.toast?.(m, e);
  const fmt = (n) => { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; n = +n || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i]; };
  const fmtGB = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(0) + " MB");
  const base = (p) => String(p).split(/[\\/]/).pop();

  const st = { file: null, info: null, disks: [], sel: null, running: false, admin: true };

  // Format Options and Partition scheme describe Rufus' file-copy mode. This
  // build writes images raw, where the image already carries its own partition
  // table and filesystem, so those controls are shown but inert.
  const PENDING = ['#usbPart', '#usbTarget', '#usbLabel', '#usbFs', '#usbCluster', '#usbQuick', '#usbExtLabel', '#usbBadBlocks', '#usbPasses', '#usbValidate', '#usbListHdd', '#usbOldBios'];
  const PENDING_TITLE = 'Applies to file-copy mode, which is not in this build yet. Images are written raw.';

  function setStatus(text, cls) {
    const el = $('#usbStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'rp-status' + (cls ? ' ' + cls : '');
  }

  function syncStart() {
    const btn = $('#usbGo');
    if (btn) btn.disabled = !st.file || !st.sel || st.running || !st.admin;
  }

  function renderDevices() {
    const sel = $('#usbDevice');
    const foot = $('#usbFoot');
    if (foot) foot.textContent = st.disks.length + (st.disks.length === 1 ? ' device found' : ' devices found');
    if (!sel) return;
    if (!st.disks.length) {
      sel.innerHTML = '<option value="">No USB drive found</option>';
      syncStart();
      return;
    }
    sel.innerHTML = st.disks.map((d) => {
      const label = (d.letters ? d.letters + ' ' : '') + d.name + ' [' + fmtGB(d.size) + ']';
      const on = st.sel && st.sel.id === d.id ? ' selected' : '';
      return '<option value="' + d.id + '"' + on + '>' + label.replace(/[<>&]/g, '') + '</option>';
    }).join('');
    if (!st.sel) { st.sel = st.disks[0]; if (sel.options.length) sel.selectedIndex = 0; }
    syncStart();
  }

  async function refresh() {
    try {
      const r = await S.diskList(false);
      st.admin = r.admin !== false;
      st.disks = r.disks || [];
      const warn = $('#usbAdmin');
      if (warn) warn.classList.toggle('hidden', st.admin);
      if (st.sel && !st.disks.find((d) => d.id === st.sel.id)) st.sel = null;
      if (!st.sel && st.disks.length === 1) st.sel = st.disks[0];
    } catch (e) {
      toast(e.message, true);
    }
    renderDevices();
  }

  async function choose() {
    const f = await S.pickSource(st.file || undefined);
    if (!f) return;
    const r = await S.inspect(f);
    if (!r.ok) { toast(r.error, true); return; }
    st.file = f;
    st.info = r.info;
    const box = $('#usbFile');
    if (box) box.value = base(f);
    const note = $('#usbStat');
    if (note) note.textContent = base(f) + ' - ' + fmt(st.info.size);
    syncStart();
  }

  async function hashImage() {
    if (!st.file) { toast('Select an image first.', true); return; }
    const btn = $('#usbHash');
    if (btn) btn.disabled = true;
    try {
      const r = await S.hash(st.file, 'sha256');
      if (r.ok) toast('SHA-256 ' + r.hash);
      else toast(r.error, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function start() {
    if (!st.file || !st.sel || st.running) return;
    if (!st.admin) { toast('Restart as administrator to write to a USB drive.', true); return; }
    if (st.info && st.info.size > st.sel.size) { toast('The image is larger than the drive.', true); return; }

    st.running = true;
    syncStart();
    setStatus('WRITING', 'busy');
    const wrap = $('#usbBarWrap');
    if (wrap) wrap.classList.remove('hidden');
    if ($('#usbBar')) $('#usbBar').style.width = '0%';
    if ($('#usbPct')) $('#usbPct').textContent = '0%';

    let r;
    try {
      r = await S.diskStart('write', { disk: st.sel, file: st.file, allocated: false, verify: true });
    } catch (e) {
      r = { ok: false, error: e.message };
    }

    st.running = false;
    if (wrap) wrap.classList.add('hidden');
    if (r.ok) {
      setStatus('DONE');
      if ($('#usbStat')) $('#usbStat').textContent = 'The drive is ready to boot.';
    } else {
      setStatus('FAILED', 'bad');
      if ($('#usbStat')) $('#usbStat').textContent = r.error || 'Writing failed.';
    }
    syncStart();
  }

  function closeTab() {
    if (st.running) { toast('A write is in progress.', true); return; }
    st.file = null;
    st.info = null;
    if ($('#usbFile')) $('#usbFile').value = '';
    if ($('#usbStat')) $('#usbStat').textContent = '';
    if ($('#usbBarWrap')) $('#usbBarWrap').classList.add('hidden');
    setStatus('READY');
    syncStart();
  }

  S.onDiskProgress((p) => {
    if (!st.running) return;
    const f = p.total ? Math.min(1, p.done / p.total) : 0;
    if ($('#usbBar')) $('#usbBar').style.width = f * 100 + '%';
    if ($('#usbPct')) $('#usbPct').textContent = Math.floor(f * 100) + '%';
    const phase = p.phase === 'verify' ? 'VERIFYING' : 'WRITING';
    setStatus(phase, 'busy');
    if ($('#usbStat')) {
      const parts = [];
      if (p.done && p.total) parts.push(fmt(p.done) + ' / ' + fmt(p.total));
      if (p.speed) parts.push(fmt(p.speed) + '/s');
      $('#usbStat').textContent = parts.join(' - ');
    }
  });

  // wire controls
  if ($('#usbDevice')) $('#usbDevice').onchange = (e) => { st.sel = st.disks.find((d) => d.id === e.target.value) || null; syncStart(); };
  if ($('#usbPick')) $('#usbPick').onclick = choose;
  if ($('#usbHash')) $('#usbHash').onclick = hashImage;
  if ($('#usbGo')) $('#usbGo').onclick = start;
  if ($('#usbClose')) $('#usbClose').onclick = closeTab;
  if ($('#usbAdvDrive')) $('#usbAdvDrive').onchange = (e) => $('#usbAdvDriveBody')?.classList.toggle('hidden', !e.target.checked);
  if ($('#usbAdvFormat')) $('#usbAdvFormat').onchange = (e) => $('#usbAdvFormatBody')?.classList.toggle('hidden', !e.target.checked);

  PENDING.forEach((sel) => {
    const el = $(sel);
    if (el) { el.disabled = true; el.title = PENDING_TITLE; }
  });

  A.usbEnter = refresh;
  setStatus('READY');
  renderDevices();
})();
