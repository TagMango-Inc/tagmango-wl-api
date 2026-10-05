# Phase 1: machine steps (Mac Studio)

These steps aren't in the repo, so they need doing by hand. Do them after
deploying the Phase 1 PR with `npm run redeploy`. Each is independent.

The values below come from the 29 Sep snapshot of the machine.

## 1. pm2 heap (`ecosystem.config.js`, prod only)

Prod already has `watch: false` and one instance per app. Only the heap and
the restart threshold need changing, on all four apps:

| Setting | Now | Change to | Why |
|---|---|---|---|
| `node_args` | `--max-old-space-size=16384` | `--max-old-space-size=2048` | The apps use 61–141 MB. A 16 GB heap ceiling on a 32 GB box lets a leak push the machine into swap (baseline: 16 GB swap used at p50). |
| `max_memory_restart` | 10–16 GB | `"1G"` | With a 2 GB heap, a process over 1 GB has leaked; restart it. |

Apply without killing a build:

```sh
cd /Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api
node scripts/queue.js pause && node scripts/queue.js wait-idle \
  && pm2 delete ecosystem.config.js && pm2 start ecosystem.config.js && pm2 save; \
node scripts/queue.js resume
```

(`delete` + `start` because pm2 does not apply a changed `node_args` on
reload.)

Check: `pm2 describe tagmango-worker | grep "node args"`.

## 2. Spotlight: stop indexing build output

Baseline: Spotlight (`mds_stores` + `mds` + `mdworker`) averaged ~75% of a
core around the clock. At p90 `mds_stores` alone was at 95%, peaking at 844%.

System Settings → Spotlight → Search Privacy → **+**, then add:

- `/Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api`
- `~/Library/Developer`
- `~/Library/Logs/gym`
- `~/.gradle`
- `~/.npm`
- `~/Library/Caches/CocoaPods`
- `~/wl-perf`

(`Cmd+Shift+.` shows hidden folders in the picker.)

## 3. One-off cleanup

- Old gym logs, 19 GB in the snapshot (Phase 1 now keeps 3 days):
  `find ~/Library/Logs/gym -mindepth 1 -mtime +3 -delete`
- Simulators left booted. One had been running for 3 days, with
  `diagnosticd` using ~39% CPU. Phase 1 shuts them down after Detox; for
  now: `xcrun simctl shutdown all`
- `audioanalyticsd` was at 99% CPU. This is a macOS daemon that gets stuck
  and restarts on its own when killed: `sudo killall audioanalyticsd`

## 4. Close editors on the build machine

VS Code ("Code Helper (Plugin)", 100% CPU in the snapshot) watches and
indexes whatever folder it has open. Close it while builds run.

## Lower priority than planned

The snapshot shows iCloud Desktop sync is off (`FXICloudDriveDesktop = 0`),
and `fileproviderd`/`bird` stayed near 0% in the samples. Moving the
checkout off `~/Desktop` is still tidier, but it is not costing CPU today.
