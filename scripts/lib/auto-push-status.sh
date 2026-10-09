#!/usr/bin/env bash
# Only real changes arm the auto-commit quiet timer. Audit run-state can still
# accompany a real change, but cannot produce endless generated-only commits.
auto_push_actionable_status() {
  git status --porcelain -- . \
    ':(exclude)data/tenant-isolation-audit/checkpoint.json' \
    ':(exclude)data/tenant-isolation-audit/latest.json' \
    ':(exclude)data/tenant-isolation-audit/degraded-latest.json' \
    ':(exclude)docs/tenant-isolation-audit-report-degraded.md'
}