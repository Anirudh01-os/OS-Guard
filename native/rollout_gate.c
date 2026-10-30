/*
 * rollout_gate.c - DIAGNOSTIC HARNESS (not part of the OSGuard application, not a kernel, not xv6).
 *
 * A small native re-implementation of two OSGuard safety rules so they can be inspected with GDB:
 *   1. readiness gate  (backend/osguard/scoring.py::assess_machine, rules B1-B6, default configuration)
 *   2. automatic halt  (backend/osguard/simulator.py::advance, canary + unhealthy-fraction rule)
 * It reads native/fleet_export.csv, recomputes every machine's readiness and compares it with the
 * verdict exported from the Python engine. Exit status 0 = identical, 1 = mismatch.
 *
 * Build: gcc -g -O0 -Wall -Wextra -o rollout_gate rollout_gate.c
 * Run:   ./rollout_gate fleet_export.csv
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef enum { CHK_PASS, CHK_FAIL, CHK_UNKNOWN } Check;
typedef enum { R_READY, R_CAUTION, R_NEEDS_APPROVAL, R_INSUFFICIENT, R_BLOCKED, R_COMPLIANT } Readiness;

static const char *READINESS_NAME[] = { "ready", "ready_with_caution", "needs_approval", "insufficient_evidence", "blocked", "compliant" };

/* Blocker bit mask, same codes as the Python engine. */
enum { B1 = 1, B2 = 2, B3 = 4, B4 = 8, B5 = 16, B6 = 32 };

typedef struct {
    char id[16], family[24], version[16], expected[32];
    Check driver, app, backup, agent, disk;
    int telemetry, vendor_hold, compliant;
    double latency_ratio, error_rate;
} Machine;

typedef struct {
    int require_telemetry;
    double latency_ratio_max, error_rate_max;
    double max_unhealthy_fraction;
    int canary_halt_on_any_failure;
} Config;

static const Config DEFAULTS = { 1, 1.5, 0.03, 0.10, 1 };

static Check parse_check(const char *s)
{
    if (!strcmp(s, "pass")) return CHK_PASS;
    if (!strcmp(s, "fail")) return CHK_FAIL;
    return CHK_UNKNOWN;
}

Readiness assess_readiness(const Machine *m, const Config *cfg, int *blockers_out)
{
    int blockers = 0, negative = 0, missing = 0, warnings = 0;
    const Check mandatory[3] = { m->driver, m->app, m->backup };
    int i;

    if (m->compliant) { *blockers_out = 0; return R_COMPLIANT; }

    for (i = 0; i < 3; i++) {
        if (mandatory[i] == CHK_FAIL)         { blockers |= B1; negative = 1; }
        else if (mandatory[i] == CHK_UNKNOWN) { blockers |= B2; missing = 1; }
    }
    if (cfg->require_telemetry && !m->telemetry) { blockers |= B3; missing = 1; }
    if (m->vendor_hold)                          { blockers |= B4; negative = 1; }
    if (m->latency_ratio > cfg->latency_ratio_max || m->error_rate > cfg->error_rate_max) { blockers |= B5; negative = 1; }
    if (!strcmp(m->family, "ICS/Embedded"))      { blockers |= B6; }
    if (m->agent != CHK_PASS || m->disk != CHK_PASS) warnings = 1;

    *blockers_out = blockers;
    if (negative) return R_BLOCKED;                  /* negative evidence beats everything */
    if (missing)  return R_INSUFFICIENT;             /* missing evidence is never "safe" */
    if (blockers & B6) return R_NEEDS_APPROVAL;
    return warnings ? R_CAUTION : R_READY;
}

/* Returns 1 when the rollout must halt after evaluating a batch. */
int should_halt(int batch_index, int batch_size, int unhealthy, const Config *cfg)
{
    double frac = batch_size ? (double)unhealthy / batch_size : 0.0;
    int canary_hit = (batch_index == 0 && cfg->canary_halt_on_any_failure && unhealthy > 0);
    return canary_hit || frac > cfg->max_unhealthy_fraction;
}

static int load(const char *path, Machine *out, int max)
{
    FILE *f = fopen(path, "r");
    char line[512];
    int n = 0;
    if (!f) { perror(path); return -1; }
    if (!fgets(line, sizeof line, f)) { fclose(f); return -1; }   /* header row */
    while (n < max && fgets(line, sizeof line, f)) {
        Machine *m = &out[n];
        char *tok[14], *p = line;
        int k = 0;
        while (k < 14 && p) {
            tok[k++] = p;
            p = strchr(p, ',');
            if (p) *p++ = '\0';
        }
        if (k < 14) continue;
        tok[13][strcspn(tok[13], "\r\n")] = '\0';
        snprintf(m->id, sizeof m->id, "%s", tok[0]);
        snprintf(m->family, sizeof m->family, "%s", tok[1]);
        snprintf(m->version, sizeof m->version, "%s", tok[2]);
        m->driver = parse_check(tok[3]);
        m->app = parse_check(tok[4]);
        m->backup = parse_check(tok[5]);
        m->agent = parse_check(tok[6]);
        m->disk = parse_check(tok[7]);
        m->telemetry = atoi(tok[8]);
        m->latency_ratio = atof(tok[9]);
        m->error_rate = atof(tok[10]);
        m->vendor_hold = atoi(tok[11]);
        m->compliant = atoi(tok[12]);
        snprintf(m->expected, sizeof m->expected, "%s", tok[13]);
        n++;
    }
    fclose(f);
    return n;
}

int main(int argc, char **argv)
{
    static Machine fleet[512];
    int n, i, mismatches = 0, counts[6] = { 0 };
    Config cfg = DEFAULTS;

    if (argc < 2) { fprintf(stderr, "usage: %s fleet_export.csv\n", argv[0]); return 2; }
    n = load(argv[1], fleet, 512);
    if (n <= 0) return 2;

    for (i = 0; i < n; i++) {
        int blockers = 0;
        Readiness r = assess_readiness(&fleet[i], &cfg, &blockers);
        counts[r]++;
        if (strcmp(READINESS_NAME[r], fleet[i].expected) != 0) {
            mismatches++;
            printf("MISMATCH %s: native=%s python=%s\n", fleet[i].id, READINESS_NAME[r], fleet[i].expected);
        }
    }
    printf("machines=%d mismatches=%d\n", n, mismatches);
    for (i = 0; i < 6; i++) printf("  %-22s %d\n", READINESS_NAME[i], counts[i]);

    /* Halt-rule self-checks (mirror tests in backend/tests/test_simulator.py). */
    printf("halt(canary,2,1)=%d expect 1\n", should_halt(0, 2, 1, &cfg));
    printf("halt(stage1,10,1)=%d expect 0 (10%% is not > 10%%)\n", should_halt(1, 10, 1, &cfg));
    printf("halt(stage1,10,2)=%d expect 1\n", should_halt(1, 10, 2, &cfg));
    return mismatches ? 1 : 0;
}
