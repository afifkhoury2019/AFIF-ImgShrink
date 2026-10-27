#ifndef AFIF_SYS_IOCTL_H
#define AFIF_SYS_IOCTL_H
static inline int ioctl(int fd, unsigned long req, ...) { (void)fd; (void)req; return -1; }
#endif
