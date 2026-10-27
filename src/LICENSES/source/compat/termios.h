#ifndef AFIF_TERMIOS_H
#define AFIF_TERMIOS_H
typedef unsigned int tcflag_t; typedef unsigned char cc_t;
struct termios { tcflag_t c_iflag, c_oflag, c_cflag, c_lflag; cc_t c_cc[32]; };
#define TCSANOW 0
#define TCSAFLUSH 2
#define ECHO 8
#define ICANON 2
#define VMIN 6
#define VTIME 5
#define ISIG 1
static inline int tcgetattr(int fd, struct termios *t) { (void)fd; (void)t; return -1; }
static inline int tcsetattr(int fd, int a, const struct termios *t) { (void)fd; (void)a; (void)t; return -1; }
#endif
