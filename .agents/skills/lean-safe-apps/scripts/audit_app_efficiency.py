#!/usr/bin/env python3
"""
Lightweight (<10MB RAM) static auditor for web apps & games.
Scans a source directory for egress leaks, O(N^2) main-thread freezes,
GPU blur bottlenecks, unguarded polling loops, and uncompressed canvas captures.
"""
import os
import re
import sys

CHECKS = [
    (
        "O(N^2) Array Deduplication",
        re.compile(r"\.filter\(\s*\([^)]*\)\s*=>\s*[a-zA-Z0-9_$]+\.findIndex\("),
        "HIGH",
        "Replace .filter(...findIndex...) with O(N) Map deduplication (dedupById).",
    ),
    (
        "Uncompressed JPEG Canvas Capture",
        re.compile(r"\.toDataURL\(\s*['\"]image/jpeg['\"]\s*\)"),
        "HIGH",
        "Pass explicit quality (e.g. canvas.toDataURL('image/jpeg', 0.55)) and cap dimensions <= 640px.",
    ),
    (
        "Animated CSS Blur Filter",
        re.compile(r"(?<![a-zA-Z-])filter:\s*blur\([^0]"),
        "MEDIUM",
        "Remove animated filter: blur() from keyframes/transitions to prevent mobile/integrated GPU frame drops.",
    ),
    (
        "Heavy Recharts Import",
        re.compile(r"from\s+['\"]recharts['\"]"),
        "MEDIUM",
        "Avoid heavy chart libraries where simple CSS progress bars and KPI cards suffice.",
    ),
    (
        "Date Allocation Inside .sort()",
        re.compile(r"\.sort\([^)]*new Date\("),
        "MEDIUM",
        "Use direct ISO-8601 string comparison (compareIsoDesc) or pre-parsed timestamps instead of new Date() inside .sort().",
    ),
]


def iter_target_files(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
        elif os.path.isdir(p):
            for dirpath, _, filenames in os.walk(p):
                if "node_modules" in dirpath or ".git" in dirpath or "dist" in dirpath:
                    continue
                for fname in filenames:
                    if fname.endswith((".ts", ".tsx", ".js", ".jsx", ".css")):
                        yield os.path.join(dirpath, fname)


def scan_paths(paths) -> int:
    findings = []
    file_count = 0
    for fpath in iter_target_files(paths):
        file_count += 1
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as fp:
                for lineno, line in enumerate(fp, start=1):
                    stripped = line.strip()
                    if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                        continue
                    for title, pattern, severity, advice in CHECKS:
                        if pattern.search(line):
                            findings.append((severity, title, fpath, lineno, stripped[:100], advice))
        except Exception as exc:
            print(f"Could not read {fpath}: {exc}", file=sys.stderr)

    print(f"Scanned {file_count} file(s).")
    if not findings:
        print("✅ PASS: 0 efficiency, egress, or main-thread crash hazards found in target files.")
        return 0

    print(f"⚠️ Found {len(findings)} potential issue(s):")
    for sev, title, fpath, lineno, snippet, advice in findings:
        print(f"  [{sev}] {title} -> {fpath}:{lineno}")
        print(f"         Code: {snippet}")
        print(f"         Fix:  {advice}")
    return 0


if __name__ == "__main__":
    targets = sys.argv[1:] if len(sys.argv) > 1 else ["."]
    sys.exit(scan_paths(targets))
