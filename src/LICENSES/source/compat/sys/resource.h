#ifndef AFIF_SYS_RESOURCE_H
#define AFIF_SYS_RESOURCE_H
#include <sys/time.h>
#define RUSAGE_SELF 0
struct rusage { struct timeval ru_utime, ru_stime; long ru_maxrss; };
static inline int getrusage(int w, struct rusage *r) { (void)w; if (r) { r->ru_utime.tv_sec = r->ru_utime.tv_usec = 0; r->ru_stime.tv_sec = r->ru_stime.tv_usec = 0; r->ru_maxrss = 0; } return 0; }
#endif
