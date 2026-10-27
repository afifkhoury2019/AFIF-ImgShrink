/*
 * afif-disk — raw SD card / USB disk reader & writer for AFIF ImgShrink.
 * (c) AFIF-TECH · Afif Khoury. GPL-2.0-only.
 *
 *   afif-disk list                         JSON list of disks
 *   afif-disk admin                        prints 1 if elevated
 *   afif-disk read   <disk> <out.img> [all|alloc]
 *   afif-disk write  <in|-> <disk> [totalBytes]
 *   afif-disk verify <in|-> <disk> [totalBytes]
 *
 * <disk> is a disk number (PhysicalDriveN) or, for testing, file:<path>.
 * Progress: "P <done> <total>" lines on stdout; errors: "E <message>" and exit 1.
 */
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <winioctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <io.h>
#include <fcntl.h>

#define CHUNK (1u << 20)

static void die(const char *fmt, ...) {
  va_list ap; va_start(ap, fmt); printf("E "); vprintf(fmt, ap); printf("\n"); va_end(ap); fflush(stdout); exit(1);
}
static const char *werr(DWORD e) {
  static char b[512]; b[0] = 0;
  FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, e, MAKELANGID(LANG_ENGLISH, SUBLANG_DEFAULT), b, sizeof b, NULL);
  size_t n = strlen(b); while (n && (b[n - 1] == '\n' || b[n - 1] == '\r' || b[n - 1] == '.')) b[--n] = 0;
  if (!n) snprintf(b, sizeof b, "Windows error %lu", (unsigned long)e);
  return b;
}
static void jstr(const char *s) {
  putchar('"');
  for (; s && *s; s++) { unsigned char c = *s; if (c == '"' || c == '\\') { putchar('\\'); putchar(c); } else if (c < 32) printf("\\u%04x", c); else putchar(c); }
  putchar('"');
}
static void trim(char *s) { size_t n = strlen(s); while (n && s[n - 1] == ' ') s[--n] = 0; char *p = s; while (*p == ' ') p++; memmove(s, p, strlen(p) + 1); }

static int is_admin(void) {
  BOOL r = FALSE; PSID g = NULL; SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
  if (AllocateAndInitializeSid(&nt, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &g)) { CheckTokenMembership(NULL, g, &r); FreeSid(g); }
  return r ? 1 : 0;
}

/* disk number that holds a volume path like \\.\C: or \\?\Volume{..} (no trailing slash); -1 on failure */
static int volume_disk(const wchar_t *vol) {
  HANDLE h = CreateFileW(vol, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  if (h == INVALID_HANDLE_VALUE) return -1;
  STORAGE_DEVICE_NUMBER sdn; DWORD r; int n = -1;
  if (DeviceIoControl(h, IOCTL_STORAGE_GET_DEVICE_NUMBER, NULL, 0, &sdn, sizeof sdn, &r, NULL) && sdn.DeviceType == FILE_DEVICE_DISK) n = (int)sdn.DeviceNumber;
  else {
    BYTE buf[sizeof(VOLUME_DISK_EXTENTS) + 8 * sizeof(DISK_EXTENT)]; VOLUME_DISK_EXTENTS *x = (VOLUME_DISK_EXTENTS *)buf;
    if (DeviceIoControl(h, IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS, NULL, 0, x, sizeof buf, &r, NULL) && x->NumberOfDiskExtents > 0) n = (int)x->Extents[0].DiskNumber;
  }
  CloseHandle(h); return n;
}
static int system_disk(void) {
  wchar_t sys[MAX_PATH]; if (!GetSystemDirectoryW(sys, MAX_PATH)) return -1;
  wchar_t v[8] = L"\\\\.\\C:"; v[4] = sys[0]; return volume_disk(v);
}

typedef struct { wchar_t name[64]; HANDLE h; } Vol;
/* all volumes on a disk; fills letters string e.g. "E: F:" */
static int disk_volumes(int disk, Vol *out, int max, char *letters, size_t lsz) {
  wchar_t vn[MAX_PATH]; int n = 0; if (letters) letters[0] = 0;
  HANDLE f = FindFirstVolumeW(vn, MAX_PATH);
  if (f == INVALID_HANDLE_VALUE) return 0;
  do {
    size_t L = wcslen(vn); if (L < 2) continue;
    wchar_t dev[MAX_PATH]; wcscpy(dev, vn); if (dev[L - 1] == L'\\') dev[L - 1] = 0;
    if (volume_disk(dev) != disk) continue;
    if (out && n < max) { wcsncpy(out[n].name, dev, 63); out[n].name[63] = 0; out[n].h = INVALID_HANDLE_VALUE; }
    n++;
    if (letters) {
      wchar_t paths[1024]; DWORD rl = 0;
      if (GetVolumePathNamesForVolumeNameW(vn, paths, 1024, &rl))
        for (wchar_t *p = paths; *p; p += wcslen(p) + 1)
          if (wcslen(p) == 3 && p[1] == L':') { size_t k = strlen(letters); if (k + 4 < lsz) { if (k) letters[k++] = ' '; letters[k++] = (char)p[0]; letters[k++] = ':'; letters[k] = 0; } }
    }
  } while (FindNextVolumeW(f, vn, MAX_PATH));
  FindVolumeClose(f);
  return n;
}

static int64_t disk_size(HANDLE h, DWORD *sector) {
  DISK_GEOMETRY_EX g; DWORD r;
  if (!DeviceIoControl(h, IOCTL_DISK_GET_DRIVE_GEOMETRY_EX, NULL, 0, &g, sizeof g, &r, NULL)) return -1;
  if (sector) *sector = g.Geometry.BytesPerSector ? g.Geometry.BytesPerSector : 512;
  return g.DiskSize.QuadPart;
}

static void cmd_list(void) {
  int sysd = system_disk();
  printf("{\"admin\":%s,\"system\":%d,\"disks\":[", is_admin() ? "true" : "false", sysd);
  int first = 1;
  for (int i = 0; i < 64; i++) {
    wchar_t p[64]; swprintf(p, 64, L"\\\\.\\PhysicalDrive%d", i);
    HANDLE h = CreateFileW(p, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) continue;
    DWORD sec = 512; int64_t size = disk_size(h, &sec);
    char vendor[128] = "", product[128] = "", serial[128] = ""; int bus = 0, removable = 0;
    STORAGE_PROPERTY_QUERY q; memset(&q, 0, sizeof q); q.PropertyId = StorageDeviceProperty; q.QueryType = PropertyStandardQuery;
    BYTE buf[4096]; DWORD r;
    if (DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, &q, sizeof q, buf, sizeof buf, &r, NULL)) {
      STORAGE_DEVICE_DESCRIPTOR *d = (STORAGE_DEVICE_DESCRIPTOR *)buf;
      if (d->VendorIdOffset && d->VendorIdOffset < r) { strncpy(vendor, (char *)buf + d->VendorIdOffset, 127); trim(vendor); }
      if (d->ProductIdOffset && d->ProductIdOffset < r) { strncpy(product, (char *)buf + d->ProductIdOffset, 127); trim(product); }
      if (d->SerialNumberOffset && d->SerialNumberOffset < r) { strncpy(serial, (char *)buf + d->SerialNumberOffset, 127); trim(serial); }
      bus = d->BusType; removable = d->RemovableMedia;
    }
    /* media present? */
    DWORD hr; int media = DeviceIoControl(h, IOCTL_STORAGE_CHECK_VERIFY2, NULL, 0, NULL, 0, &hr, NULL) ? 1 : 0;
    CloseHandle(h);
    char letters[128]; disk_volumes(i, NULL, 0, letters, sizeof letters);
    if (!first) putchar(','); first = 0;
    printf("{\"n\":%d,\"size\":%lld,\"sector\":%lu,\"bus\":%d,\"removable\":%s,\"media\":%s,\"system\":%s,\"vendor\":", i, (long long)size, (unsigned long)sec, bus, removable ? "true" : "false", media ? "true" : "false", i == sysd ? "true" : "false");
    jstr(vendor); printf(",\"product\":"); jstr(product); printf(",\"serial\":"); jstr(serial); printf(",\"letters\":"); jstr(letters); putchar('}');
  }
  printf("]}\n");
}

/* ------------------------------------------------------------------ device open/lock */
typedef struct { HANDLE h; int64_t size; DWORD sector; int disk; Vol vols[32]; int nvol; int isfile; } Dev;

static void dev_open(Dev *d, const char *spec, int write) {
  memset(d, 0, sizeof *d); d->sector = 512; d->disk = -1;
  if (!strncmp(spec, "file:", 5)) {
    d->isfile = 1;
    d->h = CreateFileA(spec + 5, GENERIC_READ | (write ? GENERIC_WRITE : 0), FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
    if (d->h == INVALID_HANDLE_VALUE) die("Cannot open %s: %s", spec + 5, werr(GetLastError()));
    LARGE_INTEGER s; GetFileSizeEx(d->h, &s); d->size = s.QuadPart; return;
  }
  char *e; long n = strtol(spec, &e, 10); if (*e || n < 0) die("Bad disk number '%s'", spec);
  d->disk = (int)n;
  if (d->disk == system_disk()) die("Disk %d holds Windows. AFIF ImgShrink never reads or writes the system disk.", d->disk);
  if (write) {
    d->nvol = disk_volumes(d->disk, d->vols, 32, NULL, 0); if (d->nvol > 32) d->nvol = 32;
    for (int i = 0; i < d->nvol; i++) {
      HANDLE v = CreateFileW(d->vols[i].name, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
      if (v == INVALID_HANDLE_VALUE) { printf("W Could not open a volume on disk %d (%s)\n", d->disk, werr(GetLastError())); continue; }
      DWORD r; int locked = 0;
      for (int t = 0; t < 20 && !locked; t++) { if (DeviceIoControl(v, FSCTL_LOCK_VOLUME, NULL, 0, NULL, 0, &r, NULL)) locked = 1; else Sleep(100); }
      if (!DeviceIoControl(v, FSCTL_DISMOUNT_VOLUME, NULL, 0, NULL, 0, &r, NULL)) printf("W Could not dismount a volume (%s)\n", werr(GetLastError()));
      if (!locked && DeviceIoControl(v, FSCTL_LOCK_VOLUME, NULL, 0, NULL, 0, &r, NULL)) locked = 1;
      if (!locked) printf("W A volume on the disk is in use; it was dismounted by force. Close Explorer windows showing the card if writing fails.\n");
      d->vols[i].h = v;
    }
    fflush(stdout);
  }
  wchar_t p[64]; swprintf(p, 64, L"\\\\.\\PhysicalDrive%d", d->disk);
  d->h = CreateFileW(p, GENERIC_READ | (write ? GENERIC_WRITE : 0), FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, 0, NULL);
  if (d->h == INVALID_HANDLE_VALUE) {
    DWORD er = GetLastError();
    if (er == ERROR_ACCESS_DENIED) die("Access denied to disk %d. Run AFIF ImgShrink as administrator.", d->disk);
    die("Cannot open disk %d: %s", d->disk, werr(er));
  }
  d->size = disk_size(d->h, &d->sector);
  if (d->size <= 0) die("Cannot read the size of disk %d. Is a card inserted?", d->disk);
}
static void dev_close(Dev *d) {
  DWORD r;
  if (!d->isfile) { FlushFileBuffers(d->h); DeviceIoControl(d->h, IOCTL_DISK_UPDATE_PROPERTIES, NULL, 0, NULL, 0, &r, NULL); }
  CloseHandle(d->h);
  for (int i = 0; i < d->nvol; i++) if (d->vols[i].h != INVALID_HANDLE_VALUE) { DeviceIoControl(d->vols[i].h, FSCTL_UNLOCK_VOLUME, NULL, 0, NULL, 0, &r, NULL); CloseHandle(d->vols[i].h); }
}
static void dev_seek(Dev *d, int64_t pos) { LARGE_INTEGER l; l.QuadPart = pos; SetFilePointerEx(d->h, l, NULL, FILE_BEGIN); }
static void dev_read(Dev *d, int64_t pos, BYTE *b, DWORD n) {
  DWORD got = 0; dev_seek(d, pos);
  if (!ReadFile(d->h, b, n, &got, NULL)) die("Read error at byte %lld: %s", (long long)pos, werr(GetLastError()));
  if (got < n) memset(b + got, 0, n - got);
}

/* ------------------------------------------------------------------ progress */
static DWORD lastTick;
static void prog(int64_t done, int64_t total, int force) {
  DWORD t = GetTickCount();
  if (force || t - lastTick > 200) { lastTick = t; printf("P %lld %lld\n", (long long)done, (long long)total); fflush(stdout); }
}

/* end of the last partition from MBR / GPT, in bytes; 0 if none */
static int64_t allocated_end(Dev *d) {
  BYTE *b = VirtualAlloc(NULL, 65536, MEM_COMMIT, PAGE_READWRITE); int64_t end = 0;
  dev_read(d, 0, b, 4096);
  if (b[510] != 0x55 || b[511] != 0xAA) { VirtualFree(b, 0, MEM_RELEASE); return 0; }
  int gpt = 0;
  for (int i = 0; i < 4; i++) {
    BYTE *e = b + 446 + i * 16; uint32_t st = *(uint32_t *)(e + 8), sz = *(uint32_t *)(e + 12);
    if (e[4] == 0xEE) gpt = 1;
    if (e[4] && sz) { int64_t x = ((int64_t)st + sz) * 512; if (x > end) end = x; }
  }
  if (gpt) {
    end = 0; dev_read(d, 512, b, 512);
    if (!memcmp(b, "EFI PART", 8)) {
      uint64_t elba = *(uint64_t *)(b + 72); uint32_t cnt = *(uint32_t *)(b + 80), esz = *(uint32_t *)(b + 84);
      if (cnt > 256) cnt = 256; if (esz < 128 || esz > 512) esz = 128;
      uint32_t bytes = (cnt * esz + 511) & ~511u; if (bytes > 65536) bytes = 65536;
      dev_read(d, (int64_t)elba * 512, b, bytes);
      for (uint32_t i = 0; i < cnt && (i + 1) * esz <= bytes; i++) {
        BYTE *e = b + i * esz; int used = 0; for (int k = 0; k < 16; k++) if (e[k]) used = 1;
        if (used) { int64_t x = ((int64_t)*(uint64_t *)(e + 40) + 1) * 512; if (x > end) end = x; }
      }
      if (end) end += 33 * 512; /* room for the backup GPT */
    }
  }
  VirtualFree(b, 0, MEM_RELEASE);
  if (end > d->size) end = d->size;
  return end;
}

static void cmd_read(const char *disk, const char *out, const char *mode) {
  Dev d; dev_open(&d, disk, 0);
  int64_t total = d.size;
  if (mode && !strcmp(mode, "alloc")) { int64_t e = allocated_end(&d); if (e > 0) total = e; else printf("W No partition table found; reading the whole device.\n"); }
  total = (total + d.sector - 1) / d.sector * d.sector; if (total > d.size) total = d.size;
  HANDLE o = CreateFileA(out, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (o == INVALID_HANDLE_VALUE) die("Cannot create %s: %s", out, werr(GetLastError()));
  BYTE *b = VirtualAlloc(NULL, CHUNK, MEM_COMMIT, PAGE_READWRITE);
  printf("S %lld\n", (long long)total);
  for (int64_t pos = 0; pos < total;) {
    DWORD n = (DWORD)((total - pos) < CHUNK ? (total - pos) : CHUNK), w;
    dev_read(&d, pos, b, n);
    if (!WriteFile(o, b, n, &w, NULL) || w != n) die("Cannot write %s: %s", out, werr(GetLastError()));
    pos += n; prog(pos, total, pos == total);
  }
  CloseHandle(o); dev_close(&d); printf("OK\n");
}

/* fill buf from a file/stdin handle; returns bytes read */
static DWORD fill(HANDLE in, BYTE *b, DWORD want) {
  DWORD got = 0;
  while (got < want) { DWORD r = 0; if (!ReadFile(in, b + got, want - got, &r, NULL) || r == 0) break; got += r; }
  return got;
}
static HANDLE open_in(const char *src, int64_t *size) {
  if (!strcmp(src, "-")) { _setmode(_fileno(stdin), _O_BINARY); return GetStdHandle(STD_INPUT_HANDLE); }
  HANDLE h = CreateFileA(src, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
  if (h == INVALID_HANDLE_VALUE) die("Cannot open %s: %s", src, werr(GetLastError()));
  LARGE_INTEGER s; GetFileSizeEx(h, &s); *size = s.QuadPart; return h;
}

static void cmd_write(const char *src, const char *disk, const char *tot, int verifyOnly) {
  int64_t total = tot ? _atoi64(tot) : 0;
  HANDLE in = open_in(src, &total);
  Dev d; dev_open(&d, disk, !verifyOnly);
  if (total > d.size) die("The image (%lld bytes) is larger than the device (%lld bytes).", (long long)total, (long long)d.size);
  BYTE *b = VirtualAlloc(NULL, CHUNK, MEM_COMMIT, PAGE_READWRITE), *c = VirtualAlloc(NULL, CHUNK, MEM_COMMIT, PAGE_READWRITE);
  int64_t pos = 0;
  printf("S %lld\n", (long long)total);
  for (;;) {
    DWORD n = fill(in, b, CHUNK); if (!n) break;
    DWORD padded = (n + d.sector - 1) / d.sector * d.sector;
    if (pos + padded > d.size) die("The image is larger than the device (%lld bytes).", (long long)d.size);
    if (verifyOnly) {
      dev_read(&d, pos, c, padded);
      if (memcmp(b, c, n)) { DWORD k = 0; while (b[k] == c[k]) k++; die("Verification failed: the device differs from the image at byte %lld.", (long long)(pos + k)); }
    } else {
      if (padded > n) memset(b + n, 0, padded - n);
      DWORD w; dev_seek(&d, pos);
      if (!WriteFile(d.h, b, padded, &w, NULL) || w != padded) die("Write error at byte %lld: %s", (long long)pos, werr(GetLastError()));
    }
    pos += n; prog(pos, total ? total : pos, 0);
    if (n < CHUNK) break;
  }
  prog(pos, total ? total : pos, 1);
  dev_close(&d); printf("N %lld\nOK\n", (long long)pos);
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOFBF, 1 << 14);
  if (argc < 2) die("usage: afif-disk list|admin|read|write|verify ...");
  if (!strcmp(argv[1], "list")) cmd_list();
  else if (!strcmp(argv[1], "admin")) printf("%d\n", is_admin());
  else if (!strcmp(argv[1], "read") && argc >= 4) cmd_read(argv[2], argv[3], argc > 4 ? argv[4] : "all");
  else if (!strcmp(argv[1], "write") && argc >= 4) cmd_write(argv[2], argv[3], argc > 4 ? argv[4] : NULL, 0);
  else if (!strcmp(argv[1], "verify") && argc >= 4) cmd_write(argv[2], argv[3], argc > 4 ? argv[4] : NULL, 1);
  else die("Unknown command");
  fflush(stdout); return 0;
}
