AFIF ImgShrink — third-party components
=======================================

AFIF ImgShrink (c) AFIF-TECH / Afif Khoury. It is distributed under the GNU
General Public License version 2 (GPL-2.0-only) because it ships programs from
e2fsprogs.

Bundled programs (resources\bin):
  e2fsck.exe, resize2fs.exe   e2fsprogs 1.47.1 (c) Theodore Ts'o and contributors, GPL-2.0
                              Source: https://git.kernel.org/pub/scm/fs/ext2/e2fsprogs.git (tag v1.47.1)
                              Windows build changes: source\e2fsprogs-1.47.1-afif-windows.patch
                              and source\compat\ (MinGW compatibility shims)
  afif-e2tool.exe             AFIF helper linked against libext2fs (GPL-2.0 / LGPL / BSD parts)
                              Source: source\afif-e2tool.c
  afif-disk.exe               AFIF raw disk reader/writer (Disk Imager), GPL-2.0. Source: source\afif-disk.c
  xz.exe                      XZ Utils 5.6.3, 0BSD — see xz-COPYING.txt and xz-0BSD.txt

The shrinking procedure follows PiShrink by Drew Bonasera
(https://github.com/Drewsif/pishrink, MIT licence); no PiShrink code is included.
The Disk Imager offers the same functions as Win32 Disk Imager; it is an
independent implementation and contains no Win32 Disk Imager code.

Built with Electron (MIT) and electron-builder (MIT).
