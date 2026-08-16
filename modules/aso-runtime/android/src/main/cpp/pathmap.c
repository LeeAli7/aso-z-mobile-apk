/*
 * libaso-pathmap.so — Termux-style перехват путей (LD_PRELOAD).
 *
 * Зачем: Termux-бинарии (apt, dpkg, bash, python…) скомпилированы с жёстким
 * путём /data/data/com.termux/files/usr ($PREFIX), а наше приложение живёт в
 * своём каталоге (files/data/usr). Под чужим prefix apt/dpkg падают:
 *   - dpkg: error opening configuration directory
 *     '/data/data/com.termux/files/usr/etc/dpkg/dpkg.cfg.d': Permission denied
 *   - apt:  E: Unable to determine a suitable packaging system type
 *
 * Эта библиотека перехватывает системные вызовы (open/stat/access/execve/...)
 * и ПОДМЕНЯЕТ префикс /data/data/com.termux/files/usr на реальный каталог
 * приложения (env ASO_PREFIX). Бинарники видят «родной» Termux-путь и работают
 * как в настоящем Termux — без проot, прямым exec (targetSdk=28 разрешает).
 *
 * Запуск: LD_PRELOAD=<prefix>/lib/libaso-pathmap.so ASO_PREFIX=<prefix> apt ...
 *
 * Идея и структура — как у termux-exec (termux-packages), но для путей, а не W^X.
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <fcntl.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <errno.h>

#define MAP_FROM "/data/data/com.termux/files/usr"

static char g_to[512] = {0};
static int  g_inited = 0;

static void init_map(void) {
    if (g_inited) return;
    g_inited = 1;
    const char *to = getenv("ASO_PREFIX");
    if (to && to[0]) {
        snprintf(g_to, sizeof(g_to), "%s", to);
    }
}

/* Подменяет путь: /data/data/com.termux/files/usr/... -> <ASO_PREFIX>/...
 * Возвращает buf (если подменил) или исходный path. */
static const char *map_path(const char *path, char *buf, size_t buflen) {
    init_map();
    if (path && g_to[0] && strncmp(path, MAP_FROM, strlen(MAP_FROM)) == 0) {
        /* /data/data/com.termux/files/usr/... -> <ASO_PREFIX>/...
         * Особый случай: ровно сам префикс (без слеша) — тоже маппим. */
        const char *rest = path + strlen(MAP_FROM);
        if (*rest == '/' || *rest == '\0') {
            snprintf(buf, buflen, "%s%s", g_to, rest);
            return buf;
        }
    }
    return path;
}

/* ---- open / open64 / openat ---- */

typedef int (*real_open_t)(const char *, int, ...);
typedef int (*real_openat_t)(int, const char *, int, ...);

static int do_open(real_open_t fn, const char *path, int flags, va_list ap) {
    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) mode = va_arg(ap, mode_t);
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, flags, mode);
}

int open(const char *path, int flags, ...) {
    real_open_t fn = (real_open_t)dlsym(RTLD_NEXT, "open");
    va_list ap; va_start(ap, flags);
    int r = do_open(fn, path, flags, ap);
    va_end(ap);
    return r;
}

int open64(const char *path, int flags, ...) {
    real_open_t fn = (real_open_t)dlsym(RTLD_NEXT, "open64");
    if (!fn) fn = (real_open_t)dlsym(RTLD_NEXT, "open");
    va_list ap; va_start(ap, flags);
    int r = do_open(fn, path, flags, ap);
    va_end(ap);
    return r;
}

int openat(int dirfd, const char *path, int flags, ...) {
    real_openat_t fn = (real_openat_t)dlsym(RTLD_NEXT, "openat");
    va_list ap; va_start(ap, flags);
    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) mode = va_arg(ap, mode_t);
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    int r = fn(dirfd, p, flags, mode);
    va_end(ap);
    return r;
}

int openat64(int dirfd, const char *path, int flags, ...) {
    real_openat_t fn = (real_openat_t)dlsym(RTLD_NEXT, "openat64");
    if (!fn) fn = (real_openat_t)dlsym(RTLD_NEXT, "openat");
    va_list ap; va_start(ap, flags);
    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) mode = va_arg(ap, mode_t);
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    int r = fn(dirfd, p, flags, mode);
    va_end(ap);
    return r;
}

/* ---- stat / lstat / fstatat (glibc __xstat/__lxstat + прямые) ---- */

typedef int (*real_stat_t)(const char *, struct stat *);
typedef int (*real_fstatat_t)(int, const char *, struct stat *, int);
typedef int (*real_xstat_t)(int, const char *, struct stat *);

int stat(const char *path, struct stat *st) {
    real_stat_t fn = (real_stat_t)dlsym(RTLD_NEXT, "stat");
    if (fn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return fn(p, st);
    }
    /* glibc: stat -> __xstat(1, path, buf) */
    real_xstat_t xfn = (real_xstat_t)dlsym(RTLD_NEXT, "__xstat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return xfn(1, p, st);
}

#if defined(__LP64__)
/* На 32-битном Android (armeabi-v7a) bionic объявляет stat64/lstat64 алиасами
 * stat/lstat — дублирующие определения ниже не нужны и не компилируются. */
int stat64(const char *path, struct stat64 *st) {
    real_stat_t fn = (real_stat_t)dlsym(RTLD_NEXT, "stat64");
    if (fn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return fn(p, (struct stat *)st);
    }
    return stat(path, (struct stat *)st);
}

int lstat64(const char *path, struct stat64 *st) {
    real_stat_t fn = (real_stat_t)dlsym(RTLD_NEXT, "lstat64");
    if (fn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return fn(p, (struct stat *)st);
    }
    return lstat(path, (struct stat *)st);
}
#endif /* __LP64__ */

int lstat(const char *path, struct stat *st) {
    real_stat_t fn = (real_stat_t)dlsym(RTLD_NEXT, "lstat");
    if (fn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return fn(p, st);
    }
    /* glibc: lstat -> __lxstat(1, path, buf) */
    real_xstat_t xfn = (real_xstat_t)dlsym(RTLD_NEXT, "__lxstat");
    if (xfn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return xfn(1, p, st);
    }
    errno = ENOSYS;
    return -1;
}

int fstatat(int dirfd, const char *path, struct stat *st, int flags) {
    real_fstatat_t fn = (real_fstatat_t)dlsym(RTLD_NEXT, "fstatat");
    if (fn) {
        char buf[4096];
        const char *p = map_path(path, buf, sizeof(buf));
        return fn(dirfd, p, st, flags);
    }
    return ((real_fstatat_t)dlsym(RTLD_NEXT, "__fstatat"))(dirfd, path, st, flags);
}

int __fstatat(int dirfd, const char *path, struct stat *st, int flags) {
    return fstatat(dirfd, path, st, flags);
}

/* ---- access / faccessat ---- */

typedef int (*real_access_t)(const char *, int);
typedef int (*real_faccessat_t)(int, const char *, int, int);

int access(const char *path, int mode) {
    real_access_t fn = (real_access_t)dlsym(RTLD_NEXT, "access");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, mode);
}

int faccessat(int dirfd, const char *path, int mode, int flags) {
    real_faccessat_t fn = (real_faccessat_t)dlsym(RTLD_NEXT, "faccessat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, mode, flags);
}

/* ---- realpath / canonicalize ---- */

typedef char *(*real_realpath_t)(const char *, char *);

char *realpath(const char *path, char *resolved) {
    real_realpath_t fn = (real_realpath_t)dlsym(RTLD_NEXT, "realpath");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, resolved);
}

char *canonicalize_file_name(const char *path) {
    real_realpath_t fn = (real_realpath_t)dlsym(RTLD_NEXT, "canonicalize_file_name");
    if (!fn) fn = (real_realpath_t)dlsym(RTLD_NEXT, "realpath");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, NULL);
}

/* ---- opendir ---- */

typedef DIR *(*real_opendir_t)(const char *);

DIR *opendir(const char *path) {
    real_opendir_t fn = (real_opendir_t)dlsym(RTLD_NEXT, "opendir");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p);
}

/* ---- fopen / fopen64 ---- */

typedef FILE *(*real_fopen_t)(const char *, const char *);

FILE *fopen(const char *path, const char *mode) {
    real_fopen_t fn = (real_fopen_t)dlsym(RTLD_NEXT, "fopen");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, mode);
}

FILE *fopen64(const char *path, const char *mode) {
    real_fopen_t fn = (real_fopen_t)dlsym(RTLD_NEXT, "fopen64");
    if (!fn) fn = (real_fopen_t)dlsym(RTLD_NEXT, "fopen");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, mode);
}

/* ---- execve / execv / execvp (apt вызывает dpkg по пути из конфига,
 *        но на случай зашитых путей тоже перехватываем) ---- */

typedef int (*real_execve_t)(const char *, char *const[], char *const[]);
typedef int (*real_exec_t)(const char *, char *const[], ...);

int execve(const char *path, char *const argv[], char *const envp[]) {
    real_execve_t fn = (real_execve_t)dlsym(RTLD_NEXT, "execve");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, argv, envp);
}

int execv(const char *path, char *const argv[]) {
    real_exec_t fn = (real_exec_t)dlsym(RTLD_NEXT, "execv");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, argv);
}

int execvp(const char *path, char *const argv[]) {
    real_exec_t fn = (real_exec_t)dlsym(RTLD_NEXT, "execvp");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, argv);
}

/* ---- mkdir / mkdirat (dpkg создаёт каталоги в var/lib/dpkg) ---- */

typedef int (*real_mkdir_t)(const char *, mode_t);
typedef int (*real_mkdirat_t)(int, const char *, mode_t);

int mkdir(const char *path, mode_t mode) {
    real_mkdir_t fn = (real_mkdir_t)dlsym(RTLD_NEXT, "mkdir");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, mode);
}

int mkdirat(int dirfd, const char *path, mode_t mode) {
    real_mkdirat_t fn = (real_mkdirat_t)dlsym(RTLD_NEXT, "mkdirat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, mode);
}

/* ---- rename / unlink / remove (dpkg переименовывает .dpkg-tmp) ---- */

typedef int (*real_rename_t)(const char *, const char *);
typedef int (*real_unlink_t)(const char *);
typedef int (*real_unlinkat_t)(int, const char *, int);
typedef int (*real_remove_t)(const char *);

int rename(const char *oldp, const char *newp) {
    real_rename_t fn = (real_rename_t)dlsym(RTLD_NEXT, "rename");
    char b1[4096], b2[4096];
    const char *o = map_path(oldp, b1, sizeof(b1));
    const char *n = map_path(newp, b2, sizeof(b2));
    return fn(o, n);
}

int unlink(const char *path) {
    real_unlink_t fn = (real_unlink_t)dlsym(RTLD_NEXT, "unlink");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p);
}

int unlinkat(int dirfd, const char *path, int flags) {
    real_unlinkat_t fn = (real_unlinkat_t)dlsym(RTLD_NEXT, "unlinkat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, flags);
}

int remove(const char *path) {
    real_remove_t fn = (real_remove_t)dlsym(RTLD_NEXT, "remove");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p);
}

/* ---- symlink / readlink / link ---- */

typedef int (*real_symlink_t)(const char *, const char *);
typedef ssize_t (*real_readlink_t)(const char *, char *, size_t);
typedef int (*real_link_t)(const char *, const char *);
typedef int (*real_symlinkat_t)(const char *, int, const char *);
typedef ssize_t (*real_readlinkat_t)(int, const char *, char *, size_t);

int symlink(const char *target, const char *linkpath) {
    real_symlink_t fn = (real_symlink_t)dlsym(RTLD_NEXT, "symlink");
    char buf[4096];
    const char *p = map_path(linkpath, buf, sizeof(buf));
    return fn(target, p);
}

ssize_t readlink(const char *path, char *buf, size_t bufsiz) {
    real_readlink_t fn = (real_readlink_t)dlsym(RTLD_NEXT, "readlink");
    char b[4096];
    const char *p = map_path(path, b, sizeof(b));
    return fn(p, buf, bufsiz);
}

int link(const char *oldp, const char *newp) {
    real_link_t fn = (real_link_t)dlsym(RTLD_NEXT, "link");
    char b1[4096], b2[4096];
    const char *o = map_path(oldp, b1, sizeof(b1));
    const char *n = map_path(newp, b2, sizeof(b2));
    return fn(o, n);
}

int symlinkat(const char *target, int newdirfd, const char *linkpath) {
    real_symlinkat_t fn = (real_symlinkat_t)dlsym(RTLD_NEXT, "symlinkat");
    char buf[4096];
    const char *p = map_path(linkpath, buf, sizeof(buf));
    return fn(target, newdirfd, p);
}

ssize_t readlinkat(int dirfd, const char *path, char *buf, size_t bufsiz) {
    real_readlinkat_t fn = (real_readlinkat_t)dlsym(RTLD_NEXT, "readlinkat");
    char b[4096];
    const char *p = map_path(path, b, sizeof(b));
    return fn(dirfd, p, buf, bufsiz);
}

/* ---- chmod / chown (dpkg выставляет права) ---- */

typedef int (*real_chmod_t)(const char *, mode_t);
typedef int (*real_chown_t)(const char *, uid_t, gid_t);
typedef int (*real_fchmodat_t)(int, const char *, mode_t, int);
typedef int (*real_fchownat_t)(int, const char *, uid_t, gid_t, int);

int chmod(const char *path, mode_t mode) {
    real_chmod_t fn = (real_chmod_t)dlsym(RTLD_NEXT, "chmod");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, mode);
}

int chown(const char *path, uid_t owner, gid_t group) {
    real_chown_t fn = (real_chown_t)dlsym(RTLD_NEXT, "chown");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(p, owner, group);
}

int fchmodat(int dirfd, const char *path, mode_t mode, int flags) {
    real_fchmodat_t fn = (real_fchmodat_t)dlsym(RTLD_NEXT, "fchmodat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, mode, flags);
}

int fchownat(int dirfd, const char *path, uid_t owner, gid_t group, int flags) {
    real_fchownat_t fn = (real_fchownat_t)dlsym(RTLD_NEXT, "fchownat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, owner, group, flags);
}

/* ---- utime (dpkg ставит mtime) ---- */

typedef int (*real_utimensat_t)(int, const char *, const struct timespec *, int);

int utimensat(int dirfd, const char *path, const struct timespec *times, int flags) {
    real_utimensat_t fn = (real_utimensat_t)dlsym(RTLD_NEXT, "utimensat");
    char buf[4096];
    const char *p = map_path(path, buf, sizeof(buf));
    return fn(dirfd, p, times, flags);
}
