#!/bin/zsh
# One-shot, read-only snapshot of the build machine: disk usage, indexing,
# sync, watchers, pm2 settings and toolchain versions. Prints no secrets.
#
#   zsh scripts/perf/host-snapshot.sh            # run from the repo root
#
# Writes ~/wl-perf/snapshot-<timestamp>.txt. `du` over the big trees can take
# a few minutes; it only reads.

# WL_REPO lets the script run from a copy outside the repo
REPO=${WL_REPO:-${0:A:h:h:h}}
OUT_DIR=~/wl-perf
mkdir -p $OUT_DIR
OUT=$OUT_DIR/snapshot-$(date +%Y%m%d-%H%M%S).txt

section() { print "\n===== $1 =====" }
size() { [[ -e $1 ]] && du -sh -x $1 2>/dev/null | cut -f1 || print "absent" }

{
  section "machine"
  date
  print "repo: $REPO"
  sw_vers
  uname -m
  print "cpus: $(sysctl -n hw.ncpu)  memory: $(( $(sysctl -n hw.memsize) / 1073741824 )) GB"
  uptime

  section "disk"
  df -h / $REPO
  diskutil info / | grep -E "Volume Name|File System Personality|Container Total Space|Container Free Space"

  section "sizes"
  for p in \
    $REPO/deployments $REPO/deployments/.trash $REPO/outputs $REPO/outputs/android \
    $REPO/root $REPO/root/TagMangoApp/.git $REPO/builds $REPO/forms $REPO/node_modules \
    ~/Library/Developer/Xcode/DerivedData ~/Library/Developer/Xcode/Archives \
    "$HOME/Library/Developer/Xcode/iOS DeviceSupport" ~/Library/Developer/CoreSimulator \
    ~/Library/Logs/gym ~/.gradle/caches ~/.gradle/daemon ~/.npm \
    ~/Library/Caches/CocoaPods ~/.cocoapods ~/.rbenv ~/Library/Caches/ccache ${TMPDIR}metro-cache
  do
    printf "%-10s %s\n" "$(size $p)" $p
  done

  section "android aab outputs"
  if [[ -d $REPO/outputs/android ]]; then
    print "count: $(ls $REPO/outputs/android/*.aab 2>/dev/null | wc -l | tr -d ' ')"
    print "oldest: $(ls -tr $REPO/outputs/android/*.aab 2>/dev/null | head -1 | xargs -I{} stat -f '%Sm %N' {})"
    print "newest: $(ls -t $REPO/outputs/android/*.aab 2>/dev/null | head -1 | xargs -I{} stat -f '%Sm %N' {})"
  fi

  section "deployment folders (newest first)"
  ls -lt $REPO/deployments 2>/dev/null | head -30
  sample=$(ls -td $REPO/deployments/*/TagMangoApp 2>/dev/null | head -1)
  if [[ -n $sample ]]; then
    print "\nsample: $sample"
    du -sh -x $sample/*(N) $sample/.[!.]*(N) 2>/dev/null | sort -h | tail -15
    print "files in sample workspace: $(find $sample -xdev 2>/dev/null | wc -l | tr -d ' ')"
  fi

  section "api repo"
  git -C $REPO branch --show-current
  git -C $REPO log -1 --format='%h %cd %s'
  git -C $REPO status --short | head -20

  section "root project"
  git -C $REPO/root/TagMangoApp branch --show-current
  git -C $REPO/root/TagMangoApp log -1 --format='%h %cd %s'
  ls -la $REPO/root/TagMangoApp | grep -E "node_modules|vendor|Pods|\.ipa|jsbundle|artifacts|build"
  ls -d $REPO/root/TagMangoApp/ios/Pods 2>/dev/null
  print "release.json: $(cat $REPO/data/release.json 2>/dev/null)"

  section "spotlight"
  mdutil -s / 2>&1
  mdutil -s $REPO 2>&1
  sudo -n defaults read /System/Volumes/Data/.Spotlight-V100/VolumeConfiguration.plist Exclusions 2>/dev/null \
    || print "exclusions: needs sudo (optional: sudo defaults read /System/Volumes/Data/.Spotlight-V100/VolumeConfiguration.plist Exclusions)"

  section "icloud desktop and documents"
  [[ -d ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop ]] && print "iCloud Desktop folder: present" || print "iCloud Desktop folder: absent"
  defaults read com.apple.finder FXICloudDriveDesktop 2>/dev/null || true
  print "repo path is under Desktop: $([[ $REPO == $HOME/Desktop/* ]] && print yes || print no)"

  section "time machine"
  tmutil destinationinfo 2>&1 | head -8
  tmutil isexcluded $REPO 2>&1
  tmutil isexcluded ~/Library/Developer 2>&1

  section "watchman"
  if command -v watchman >/dev/null; then
    watchman version 2>&1 | grep -E '"version"'
    print "watched roots: $(watchman watch-list 2>&1 | grep -c '"/')"
    watchman watch-list 2>&1 | grep '"/' | head -20
  else
    print "not installed"
  fi

  section "pm2 apps (no env)"
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      try {
        for (const a of JSON.parse(s)) {
          const e = a.pm2_env || {};
          console.log([a.name, "mode=" + e.exec_mode, "instances=" + e.instances,
            "watch=" + JSON.stringify(e.watch), "node_args=" + JSON.stringify(e.node_args),
            "max_mem=" + e.max_memory_restart, "restarts=" + e.restart_time,
            "rss_mb=" + Math.round((a.monit?.memory || 0) / 1048576), "cpu=" + a.monit?.cpu,
            "cwd=" + e.pm_cwd].join("  "));
        }
      } catch { console.log("could not read pm2 jlist"); }
    });'

  section "toolchain"
  print "node $(node -v)  npm $(npm -v)"
  zsh -lc 'source ~/.zshrc >/dev/null 2>&1; print "ruby $(ruby -v)"; print "bundler $(bundle -v)"; print "pod $(pod --version 2>/dev/null)"'
  xcodebuild -version
  xcode-select -p
  java -version 2>&1 | head -1
  for t in xcbeautify ccache detox; do printf "%s: %s\n" $t "$(command -v $t || print missing)"; done
  print "NODE_OPTIONS=${NODE_OPTIONS:-<unset>}  GRADLE_OPTS=${GRADLE_OPTS:-<unset>}  JAVA_HOME=${JAVA_HOME:-<unset>}"
  print "~/.gradle/gradle.properties:"
  grep -viE "password|secret|token|key" ~/.gradle/gradle.properties 2>/dev/null || print "  (none)"

  section "redis / queues"
  redis-cli info memory 2>/dev/null | grep -E "used_memory_human|maxmemory_human"
  for q in buildQueue redeploymentQueue; do
    print "$q wait=$(redis-cli llen bull:$q:wait 2>/dev/null) active=$(redis-cli llen bull:$q:active 2>/dev/null) delayed=$(redis-cli zcard bull:$q:delayed 2>/dev/null)"
  done

  section "memory"
  sysctl vm.swapusage
  print "pressure level (1 normal, 2 warn, 4 critical): $(sysctl -n kern.memorystatus_vm_pressure_level)"
  vm_stat | grep -E "Pages free|Pages active|Pageouts|Swapouts|Compressor"

  section "top processes by cpu"
  ps -Ao pid,pcpu,pmem,rss,etime,comm -r | head -25
} > $OUT 2>&1

print "Snapshot written to $OUT"
