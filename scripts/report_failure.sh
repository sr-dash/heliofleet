#!/usr/bin/env bash
# Opens an issue for a failed workflow run, or comments on the open one with
# the same title, so a failure is not missed. Run inside GitHub Actions.
#   bash scripts/report_failure.sh "Issue title"
set -euo pipefail
title="$1"
run="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
body="The **${GITHUB_WORKFLOW}** workflow failed on $(date -u +%Y-%m-%d). See the log: ${run}"
existing=$(gh issue list --state open --search "\"${title}\" in:title" --json number,title \
  -q ".[] | select(.title == \"${title}\") | .number" | head -n 1)
if [ -n "$existing" ]; then
  gh issue comment "$existing" --body "$body"
else
  gh label create maintenance --color FBCA04 --description "Data and link upkeep" 2>/dev/null || true
  gh issue create --title "$title" --body "$body" --label maintenance
fi
