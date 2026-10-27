# AFIF ImgShrink 1.2.0 — with AS USB

Electron desktop app for Windows that shrinks Raspberry Pi / Linux disk images,
reads and writes SD cards, and (new in 1.2.0) creates bootable USB drives.

The bootable-USB feature is **AS USB**, a tab inside the app that launches the
bundled `AS-USB.exe` writing engine. That engine is a build of **Rufus 4.15**
(GPLv3) renamed and re-iconed only — see [licenses/AS-USB-NOTICE.txt](licenses/AS-USB-NOTICE.txt).

## What's in 1.2.0

| Change | Detail |
|---|---|
| New tab | **AS USB** in the top tab bar, next to Shrink image and Disk Imager |
| New IPC channel | `launch-usb` in `src/main.js`, exposed as `launchUsb()` in `src/preload.js` |
| New payload | `resources/bin/AS-USB.exe` (the Rufus-based engine) |
| New UI | `#usb` section + `.ti.usb` icon in `src/ui/index.html` and `src/ui/styles.css` |

Behaviour: the button starts `AS-USB.exe` with `Start-Process -Verb RunAs`,
because the engine declares `requireAdministrator`. If AFIF ImgShrink is already
elevated there is no prompt; otherwise Windows shows one UAC prompt.

## Layout

```
src/                 the Electron app (what goes into resources/app)
  main.js            main process, window, IPC
  preload.js         contextBridge surface
  disk.js            disk read/write/verify
  engine.js          image shrink engine (wraps e2fsprogs)
  ui/                index.html, app.js, imager.js, styles.css, theme.css
  build/icon.png     window/app icon
  LICENSES/          third-party licences and the e2fsprogs patch set
installer/
  installer.nsi      NSIS 3.11 installer, including AS USB
  app.ico            installer icon
licenses/
  AS-USB-NOTICE.txt  AS USB attribution and GPLv3 obligations
  LICENSE-RUFUS.txt  GPLv3 full text
```

## Building the installer

The installer needs the Electron runtime payload (Chromium DLLs, `.pak` files,
`locales/`, and `AFIF ImgShrink.exe`). That payload is not committed here — it is
extracted from the published 1.1.0 installer with 7-Zip:

```powershell
7za x AFIF-ImgShrink-Setup-1.1.0.exe -o payload
# replace resources/app.asar with the unpacked source in src/
Remove-Item payload\resources\app.asar
Copy-Item src payload\resources\app -Recurse
# add the USB engine
Copy-Item AS-USB.exe payload\resources\bin\AS-USB.exe
# build
makensis /DSRCDIR="payload" installer\installer.nsi
```

Output: `AFIF-ImgShrink-Setup-1.2.0.exe`.

## Verification performed

- `node --check` passes on all six JS files (`main.js`, `preload.js`, `disk.js`,
  `engine.js`, `ui/app.js`, `ui/imager.js`).
- Installer built with NSIS 3.11 (LZMA solid), 80.9 MB, exit code 0.
- Payload assembled by hashing: `resources/app/*` and `resources/bin/AS-USB.exe`
  were copied from the verified sources and compared by SHA-256.

Not verified: a GUI install and click-through, because the build environment
cannot launch GUI processes. Test the AS USB button on a real Windows desktop.

## Licensing

The app declares `GPL-2.0-only`; it bundles e2fsprogs (GPL-2.0), xz (0BSD),
Electron (MIT) and, as of 1.2.0, AS USB (GPLv3). Publishing this source is what
keeps the distribution compliant. Keep `notices` with any binary you ship.
