#!/bin/zsh
# Phase 0 in one command, run on the build machine from a clone of this repo
# (not the prod folder):
#
#   zsh ~/wl-perf/src/scripts/perf/phase0.sh          # snapshot + sampler + deploy timing
#   zsh ~/wl-perf/src/scripts/perf/phase0.sh report   # after ~3 days: host summary
#
# Safe while bulk redeploys run: the build queue is paused, the running build
# finishes, the worker is restarted, and the queue is resumed even on failure.
set -u

PROD=${WL_REPO:-/Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api}
SRC=${0:A:h:h:h}
export WL_REPO=$PROD
WORKER=tagmango-worker
mkdir -p ~/wl-perf
LOG=~/wl-perf/phase0-$(date +%Y%m%d-%H%M%S).log
exec > >(tee -a $LOG) 2>&1

step() { print "\n==> $1" }
fail() { print "\n!! $1"; exit 1 }

if [[ ${1:-} == report ]]; then
  since=$(ls ~/wl-perf/host/*.jsonl 2>/dev/null | head -1 | xargs -n1 basename | cut -c1-10)
  [[ -n $since ]] || fail "no sampler data in ~/wl-perf/host"
  node $SRC/scripts/perf/summarize-host.js --since $since --out ~/wl-perf/host-before.json > /dev/null \
    && print "Send this file back: ~/wl-perf/host-before.json"
  exit
fi

[[ -d $PROD/.git ]] || fail "prod repo not found at $PROD (set WL_REPO)"
[[ $SRC != $PROD ]] || fail "run this from the ~/wl-perf/src clone, not the prod folder"

step "1/3 machine snapshot (read-only, a few minutes)"
zsh $SRC/scripts/perf/host-snapshot.sh

step "2/3 host sampler"
if pm2 describe wl-perf-sampler > /dev/null 2>&1; then
  pm2 restart wl-perf-sampler --update-env
else
  (cd ~/wl-perf && pm2 start $SRC/scripts/perf/host-sampler.js --name wl-perf-sampler)
fi
pm2 save
sleep 5
tail -1 ~/wl-perf/host/$(date -u +%F).jsonl > /dev/null 2>&1 && print "sampler writing to ~/wl-perf/host/" || print "sampler: no sample yet, check: pm2 logs wl-perf-sampler"

step "3/3 deploy worker timing"
cd $PROD
if [[ -f src/job/taskPerf.ts && -f dist/src/job/taskPerf.js ]]; then
  print "already deployed, nothing to do"
else
  git fetch origin main || fail "git fetch failed"
  git cat-file -e origin/main:src/job/taskPerf.ts 2>/dev/null || fail "Phase 0 is not merged into main yet"
  [[ $(git branch --show-current) == main ]] || fail "prod is not on main"
  git diff --quiet && git diff --cached --quiet || fail "prod has uncommitted changes to tracked files: $(git diff --name-only | tr '\n' ' ')"
  git merge-base --is-ancestor HEAD origin/main || fail "prod main has local commits; not fast-forwarding"

  # only take Phase 0's files; anything else on main should ship on its own
  others=$(git diff --name-only HEAD origin/main | grep -vE '^(scripts/perf/|perf/|src/job/taskPerf\.ts|src/job/worker\.ts|src/types/database\.ts)')
  [[ -z $others ]] || fail "main has other unreleased changes, deploy those first: $others"

  pm2 describe $WORKER > /dev/null 2>&1 || fail "pm2 app $WORKER not found"
  Q=(node $SRC/scripts/queue.js)
  PREV=$(git rev-parse HEAD)

  restore() {
    pm2 start $WORKER
    $Q resume
  }
  trap restore EXIT

  $Q pause
  print "waiting for the running build to finish..."
  $Q wait-idle
  pm2 stop $WORKER

  git merge --ff-only origin/main || fail "fast-forward failed"
  if ! npm run build; then
    print "build failed, rolling back to $PREV"
    git reset --keep $PREV && npm run build
    fail "Phase 0 build failed; worker restored on the previous version"
  fi
  print "deployed $(git log -1 --format='%h %s')"
fi

print "\nDone. Log: $LOG"
print "Send back: $(ls -t ~/wl-perf/snapshot-*.txt | head -1)"
print "In ~3 days run: zsh $SRC/scripts/perf/phase0.sh report"
