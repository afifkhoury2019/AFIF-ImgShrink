/* Link-time POSIX shims for the Windows build of e2fsprogs tools (AFIF-TECH). */
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <errno.h>
static __thread int (*g_cmp)(const void *, const void *, void *);
static __thread void *g_arg;
static int tramp(const void *a, const void *b) { return g_cmp(a, b, g_arg); }
void qsort_r(void *base, size_t n, size_t w, int (*cmp)(const void *, const void *, void *), void *arg) {
  int (*pc)(const void *, const void *, void *) = g_cmp; void *pa = g_arg;
  g_cmp = cmp; g_arg = arg; qsort(base, n, w, tramp); g_cmp = pc; g_arg = pa;
}
struct tm *gmtime_r(const time_t *t, struct tm *r) { return gmtime_s(r, t) ? NULL : r; }
struct tm *localtime_r(const time_t *t, struct tm *r) { return localtime_s(r, t) ? NULL : r; }
int gethostname(char *n, size_t l) { if (l) { strncpy(n, "windows", l); n[l - 1] = 0; } return 0; }
int pipe(int *fds) { (void)fds; errno = ENOSYS; return -1; }
int fork(void) { errno = ENOSYS; return -1; }
int daemon(int a, int b) { (void)a; (void)b; errno = ENOSYS; return -1; }
