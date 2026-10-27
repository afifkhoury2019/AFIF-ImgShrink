# AFIF ImgShrink 1.4.0

Electron desktop app for Windows: shrink Raspberry Pi / Linux disk images, read,
write and verify SD cards, and create bootable USB drives.

Everything runs inside one window. There is no separate helper application and no
third-party USB writer bundled: the **AS USB** tab drives the same `afif-disk`
engine the Disk Imager tab already uses.

## What changed in 1.4.0

The **AS USB** tab now mirrors Rufus 4.15's main window control-for-control
(27 controls in the original dialog; 29 elements here including grouped bodies).

| Rufus control | AS USB | State |
|---|---|---|
| Device combo | `usbDevice` | live - lists removable drives |
| Boot selection + SELECT | `usbFile` + `usbPick` | live - picks the image |
| Hash button | `usbHash` | live - SHA-256 of the image |
| Partition scheme | `usbPart` | shown, inert in raw mode |
| Target system | `usbTarget` | shown, inert in raw mode |
| Show advanced drive properties | `usbAdvDrive` | live - reveals the two toggles |
| Volume label / File system / Cluster size | `usbLabel`/`usbFs`/`usbCluster` | shown, inert in raw mode |
| Show advanced format options | `usbAdvFormat` | live - reveals the toggles |
| Quick format / extended label / bad blocks / passes / UEFI validation | `usbQuick` `usbExtLabel` `usbBadBlocks` `usbPasses` `usbValidate` | shown, inert in raw mode |
| Status box + READY | `usbStatus` | live - READY / WRITING / VERIFYING / DONE / FAILED |
| START / CLOSE | `usbGo` / `usbClose` | live |
| "N device found" | `usbFoot` | live |

"Shown, inert" means the control is present and laid out like Rufus but disabled
with an explanation: raw image writing keeps the partition table and filesystem
that are already inside the image, so those settings only apply once file-copy
mode exists. The tab says so in two notes rather than showing dead controls as
if they worked.
## What changed in 1.3.0

| Change | Detail |
|---|---|
| AS USB tab is now native | Own UI in the app window: choose image, choose drive, write, verify, progress, log |
| Removed | The bundled `AS-USB.exe` (Rufus-based) and its launch IPC channel |
| Removed | Rufus/GPLv3 notices for that component - no Rufus code ships any more |
| Kept | Shrink image, Disk Imager, hashing and compression from 1.2.0 |

The tab is self-contained: `src/ui/usb.js` (new), a `#usb` section in
`src/ui/index.html`, and one hook in `src/ui/imager.js` (`A.usbEnter`) that
refreshes the drive list when the tab opens. Writing goes through the existing
`disk-start` IPC with `{ disk, file, verify }` - the same path the Disk Imager
uses for its Write action.

## Supported in the AS USB tab

- Raspberry Pi OS, Ubuntu, DietPi, Home Assistant and other Linux images
- Any `.img`, and `.iso` files that are isohybrid (the common Linux case)
- Optional read-back verification after writing

**Not supported yet:** Windows setup ISOs (`.iso` from Microsoft). Those need
file-level extraction into a FAT32/NTFS partition plus boot-sector handling,
which is a separate piece of work - the tab says so rather than producing a USB
that silently fails to boot.

## Layout

```
src/                 Electron app (goes to resources/app)
  main.js            main process, window, IPC
  preload.js         contextBridge surface
  disk.js            disk read/write/verify via afif-disk
  engine.js          image shrink engine (e2fsprogs)
  ui/index.html      three tabs
  ui/imager.js       tab switcher + Disk Imager
  ui/usb.js          AS USB tab
installer/
  installer.nsi      NSIS 3.11 installer
  app.ico            installer icon
```

## Building

The installer needs the Electron runtime payload, extracted from the published
1.1.0 installer (not committed here):

```powershell
7za x AFIF-ImgShrink-Setup-1.1.0.exe -o payload
Remove-Item payload\resources\app.asar
Copy-Item src payload\resources\app -Recurse
makensis /DSRCDIR="payload" installer\installer.nsi
```

## Verification

- `node --check` passes on all seven JS files
- CI asserts the tab exists: `data-tab="usb"`, `id="usb"`, `usb.js` script tag,
  `A.usbEnter` hook
- Installer built with NSIS 3.11, exit 0

Not verified: a GUI click-through, because the build environment cannot launch
GUI processes. Test the AS USB tab on a real Windows desktop.

## Licensing

GPL-2.0-only, as the app already declared. Bundles e2fsprogs (GPL-2.0), xz (0BSD)
and Electron (MIT) - see `src/LICENSES`.

