/*
 * afif-e2tool — tiny ext2/3/4 helper for AFIF ImgShrink (Windows), built on libext2fs (e2fsprogs).
 *   afif-e2tool cat <image?offset=N> <path>              print a file to stdout
 *   afif-e2tool mv  <image?offset=N> <from> <to>         rename within the same directory tree
 *   afif-e2tool put <image?offset=N> <localfile> <path> <octal-mode>
 *   afif-e2tool rm  <image?offset=N> <path>
 * Copyright (c) AFIF-TECH. e2fsprogs is GPL-2.0 / LGPL-2.0.
 */
#include "config.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include "ext2fs/ext2fs.h"
#include "create_inode.h"
#ifdef _WIN32
#include <io.h>
#define IOMGR windows_io_manager
#else
#define IOMGR unix_io_manager
#endif

static int ext2_file_type(unsigned int mode) {
  if (LINUX_S_ISREG(mode)) return EXT2_FT_REG_FILE; if (LINUX_S_ISDIR(mode)) return EXT2_FT_DIR; if (LINUX_S_ISLNK(mode)) return EXT2_FT_SYMLINK;
  if (LINUX_S_ISCHR(mode)) return EXT2_FT_CHRDEV; if (LINUX_S_ISBLK(mode)) return EXT2_FT_BLKDEV; if (LINUX_S_ISFIFO(mode)) return EXT2_FT_FIFO; if (LINUX_S_ISSOCK(mode)) return EXT2_FT_SOCK; return 0;
}
int no_copy_xattrs = 1; /* mke2fs option referenced by create_inode.c */
/* tar import is not used by this tool */
errcode_t __populate_fs_from_tar(ext2_filsys fs, ext2_ino_t root, const char *src, ext2_ino_t parent, ext2_ino_t parent2, void *a, void *b, void *c) { (void)fs; (void)root; (void)src; (void)parent; (void)parent2; (void)a; (void)b; (void)c; return EXT2_ET_UNIMPLEMENTED; }
static int die(const char *what, errcode_t e) { fprintf(stderr, "afif-e2tool: %s: error %ld\n", what, (long)e); return 2; }

static errcode_t split(ext2_filsys fs, const char *path, ext2_ino_t *dir, char **base) {
  char *p = strdup(path), *slash = strrchr(p, '/');
  if (!slash) { free(p); return EXT2_ET_FILE_NOT_FOUND; }
  *base = strdup(slash + 1);
  if (slash == p) { *dir = EXT2_ROOT_INO; free(p); return 0; }
  *slash = 0;
  errcode_t e = ext2fs_namei(fs, EXT2_ROOT_INO, EXT2_ROOT_INO, p, dir);
  free(p); return e;
}
static errcode_t kill_file(ext2_filsys fs, ext2_ino_t dir, const char *name, ext2_ino_t ino) {
  struct ext2_inode in; errcode_t e;
  if ((e = ext2fs_unlink(fs, dir, name, ino, 0))) return e;
  if ((e = ext2fs_read_inode(fs, ino, &in))) return e;
  if (in.i_links_count > 0) in.i_links_count--;
  if (in.i_links_count == 0) {
    in.i_dtime = fs->now ? fs->now : time(0);
    if (ext2fs_inode_has_valid_blocks2(fs, &in)) { if ((e = ext2fs_punch(fs, ino, &in, NULL, 0, ~0ULL))) return e; }
    ext2fs_inode_alloc_stats2(fs, ino, -1, LINUX_S_ISDIR(in.i_mode));
  }
  return ext2fs_write_inode(fs, ino, &in);
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: afif-e2tool cat|mv|put|rm <image?offset=N> ...\n"); return 1; }
  const char *cmd = argv[1]; char *dev = strdup(argv[2]), *opts = strchr(dev, '?');
  if (opts) *opts++ = 0;
  ext2_filsys fs; errcode_t e;
  int rw = strcmp(cmd, "cat") != 0;
  add_error_table(&et_ext2_error_table);
  if ((e = ext2fs_open2(dev, opts, (rw ? EXT2_FLAG_RW : 0) | EXT2_FLAG_64BITS, 0, 0, IOMGR, &fs))) return die("open filesystem", e);
  if (rw && (e = ext2fs_read_bitmaps(fs))) return die("read bitmaps", e);
  int rc = 0;
  if (!strcmp(cmd, "cat")) {
    ext2_ino_t ino; ext2_file_t f; char buf[65536]; unsigned int got;
    if ((e = ext2fs_namei(fs, EXT2_ROOT_INO, EXT2_ROOT_INO, argv[3], &ino))) { ext2fs_close_free(&fs); return 3; } /* 3 = not found */
    if ((e = ext2fs_file_open(fs, ino, 0, &f))) return die("open file", e);
#ifdef _WIN32
    _setmode(1, _O_BINARY);
#endif
    while (!(e = ext2fs_file_read(f, buf, sizeof buf, &got)) && got) fwrite(buf, 1, got, stdout);
    ext2fs_file_close(f);
  } else if (!strcmp(cmd, "mv") && argc >= 5) {
    ext2_ino_t sdir, ddir, ino, old; char *sb, *db;
    if ((e = split(fs, argv[3], &sdir, &sb)) || (e = ext2fs_lookup(fs, sdir, sb, strlen(sb), 0, &ino))) { ext2fs_close_free(&fs); return 3; }
    if ((e = split(fs, argv[4], &ddir, &db))) return die("target dir", e);
    if (!ext2fs_lookup(fs, ddir, db, strlen(db), 0, &old)) { if ((e = kill_file(fs, ddir, db, old))) return die("remove old target", e); }
    struct ext2_inode in; ext2fs_read_inode(fs, ino, &in);
    e = ext2fs_link(fs, ddir, db, ino, ext2_file_type(in.i_mode));
    if (e == EXT2_ET_DIR_NO_SPACE) { if (!(e = ext2fs_expand_dir(fs, ddir))) e = ext2fs_link(fs, ddir, db, ino, ext2_file_type(in.i_mode)); }
    if (e) return die("link", e);
    if ((e = ext2fs_unlink(fs, sdir, sb, ino, 0))) return die("unlink", e);
  } else if (!strcmp(cmd, "rm")) {
    ext2_ino_t dir, ino; char *b;
    if ((e = split(fs, argv[3], &dir, &b)) || (e = ext2fs_lookup(fs, dir, b, strlen(b), 0, &ino))) { ext2fs_close_free(&fs); return 3; }
    if ((e = kill_file(fs, dir, b, ino))) return die("remove", e);
  } else if (!strcmp(cmd, "put") && argc >= 6) {
    ext2_ino_t dir, ino, old; char *b;
    if ((e = split(fs, argv[4], &dir, &b))) return die("target dir", e);
    if (!ext2fs_lookup(fs, dir, b, strlen(b), 0, &old)) { if ((e = kill_file(fs, dir, b, old))) return die("remove old file", e); }
    if ((e = do_write_internal(fs, dir, argv[3], b, EXT2_ROOT_INO))) return die("write file", e);
    if ((e = ext2fs_lookup(fs, dir, b, strlen(b), 0, &ino))) return die("lookup new file", e);
    struct ext2_inode in; ext2fs_read_inode(fs, ino, &in);
    in.i_mode = LINUX_S_IFREG | (strtol(argv[5], 0, 8) & 07777); in.i_uid = 0; in.i_gid = 0; ext2fs_set_i_uid_high(in, 0); ext2fs_set_i_gid_high(in, 0);
    if ((e = ext2fs_write_inode(fs, ino, &in))) return die("set mode", e);
  } else { fprintf(stderr, "afif-e2tool: unknown command\n"); rc = 1; }
  if ((e = ext2fs_close_free(&fs))) return die("close", e);
  return rc;
}
