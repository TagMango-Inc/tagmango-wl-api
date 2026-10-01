#!/bin/zsh
# npm run redeploy: ship the latest code to the pm2 apps without killing a
# running build.
#
#   1. checks the repo can fast-forward (before touching anything)
#   2. pauses both queues and waits for running jobs to finish
#   3. pulls, installs deps if the lockfile changed, builds
#   4. starts or reloads every app in ecosystem.config.js
#   5. resumes the queues (always, even if a step fails)
#
# A failed build rolls back to the previous commit and rebuilds, so the apps
# never come back on half-built code.
#   npm run redeploy -- --no-pull   # just rebuild and reload what is checked out
set -u

cd ${0:A:h:h}
Q=(node scripts/queue.js)
PULL=1
[[ ${1:-} == --no-pull ]] && PULL=0

step() { print "\n==> $1" }
fail() { print "\n!! $1"; exit 1 }

[[ -f ecosystem.config.js ]] || fail "ecosystem.config.js not found in $PWD"
git diff --quiet && git diff --cached --quiet \
  || fail "uncommitted changes to tracked files: $(git diff --name-only | tr '\n' ' ')"

PREV=$(git rev-parse HEAD)
if (( PULL )); then
  step "checking for new commits"
  git fetch || fail "git fetch failed"
  git rev-parse @{u} > /dev/null 2>&1 || fail "branch $(git branch --show-current) has no upstream"
  git merge-base --is-ancestor HEAD @{u} || fail "local commits not on $(git rev-parse --abbrev-ref @{u}); not fast-forwarding"
  incoming=$(git log --oneline HEAD..@{u})
  print ${incoming:-"none (rebuilding and reloading the current code)"}
fi

resume() { step "resuming queues"; $Q resume }
trap resume EXIT

step "pausing queues"
$Q pause || fail "could not reach Redis"
step "waiting for running jobs to finish"
$Q wait-idle

if (( PULL )); then
  step "pulling"
  git merge --ff-only @{u} || fail "fast-forward failed"
fi

DEPS_CHANGED=0
if git diff --name-only $PREV HEAD | grep -q '^package-lock.json$'; then
  DEPS_CHANGED=1
  step "package-lock.json changed, installing"
  npm ci || fail "npm ci failed"
fi

step "building"
if ! npm run build; then
  print "\n!! build failed, rolling back to $PREV"
  git reset --keep $PREV \
    && { (( ! DEPS_CHANGED )) || npm ci; } \
    && npm run build \
    && pm2 startOrReload ecosystem.config.js --update-env
  fail "redeploy failed; apps are on the previous version"
fi

step "starting / reloading pm2 apps"
pm2 startOrReload ecosystem.config.js --update-env || fail "pm2 reload failed"
pm2 save > /dev/null

print "\nDeployed $(git log -1 --format='%h %s')"
