/* Minimal POSIX shims so resize2fs / e2fsck / tune2fs / debugfs build for Windows (MinGW). AFIF-TECH. */
#ifndef AFIF_COMPAT_H
#define AFIF_COMPAT_H
#ifdef _WIN32
#include <signal.h>
#include <string.h>
#define unix_io_manager windows_io_manager
#ifndef NAME_MAX
#define NAME_MAX 255
#endif
#ifndef SIGUSR1
#define SIGUSR1 30
#endif
#ifndef SIGUSR2
#define SIGUSR2 31
#endif
#ifndef SIGPIPE
#define SIGPIPE 13
#endif
#ifndef SIGBUS
#define SIGBUS 10
#endif
#ifndef SA_RESTART
#define SA_RESTART 0
#endif
#ifndef SA_SIGINFO
#define SA_SIGINFO 0
#endif
typedef int afif_sigset_t;
#define sigset_t afif_sigset_t
typedef struct { int si_signo; int si_code; void *si_addr; int si_errno; int si_pid; int si_uid; } siginfo_t;
struct sigaction { void (*sa_handler)(int); void (*sa_sigaction)(int, siginfo_t *, void *); sigset_t sa_mask; int sa_flags; };
static inline int sigaction(int s, const struct sigaction *a, struct sigaction *o) { if (o) memset(o, 0, sizeof(*o)); if (a && a->sa_handler && s < NSIG && s != SIGUSR1 && s != SIGUSR2 && s != SIGPIPE && s != SIGBUS) signal(s, a->sa_handler); return 0; }
static inline int sigemptyset(sigset_t *s) { *s = 0; return 0; }
static inline int sigaddset(sigset_t *s, int n) { (void)s; (void)n; return 0; }
static inline int sigprocmask(int h, const sigset_t *a, sigset_t *b) { (void)h; (void)a; if (b) *b = 0; return 0; }
#define SIG_BLOCK 0
#ifndef SI_USER
#define SI_USER 0
#endif
#ifndef SIGCHLD
#define SIGCHLD 17
#endif
#ifndef SIGHUP
#define SIGHUP 1
#endif
#ifndef SIGQUIT
#define SIGQUIT 3
#endif
#ifndef SIGTRAP
#define SIGTRAP 5
#endif
#ifndef SIGALRM
#define SIGALRM 14
#endif
#ifndef SIGKILL
#define SIGKILL 9
#endif
static inline void *sbrk(long inc) { (void)inc; return (void *)0; }
#define SIG_SETMASK 2
#endif
#endif
