# Phase 1: machine steps (Mac Studio)

These steps aren't in the repo, so they need doing by hand. Do them after
deploying the Phase 1 PR with `npm run redeploy`. Each is independent.

## 1. pm2 settings (`ecosystem.config.js`, prod only)

For all four apps:

| Setting | Now | Change to | Why |
|---|---|---|---|
| `node_args` | `--max-old-space-size=16384` | `--max-old-space-size=2048` | The apps use 55–145 MB. A 16 GB heap ceiling on a 32 GB box lets a leak push the machine into swap (baseline: 16 GB swap used at p50). |
| `watch` | `true` | `false` | pm2 watches the whole repo, including `deployments/`, and restarts on change. Deploys go through `npm run redeploy` now. |
| `max_memory_restart` | `"5wG"` (typo) / `"5G"` | `"1G"` | With a 2 GB heap, a process over 1 GB has leaked; restart it. |

`tagmango-cron` can drop to `instances: 1`. Since Phase 1 only instance 0
schedules anything, so 2 is harmless, just wasted.

Apply without killing a build:

```sh
cd /Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api
node scripts/queue.js pause && node scripts/queue.js wait-idle \
  && pm2 delete ecosystem.config.js && pm2 start ecosystem.config.js && pm2 save; \
node scripts/queue.js resume
```

(`delete` + `start` because pm2 does not apply a changed `node_args` or
`watch` on reload.)

Check: `pm2 describe tagmango-worker | grep -E "node args|watch"`.

## 2. Spotlight: stop indexing build output

Baseline: Spotlight (`mds_stores` + `mds` + `mdworker`) averaged ~75% of a
core around the clock. At p90 `mds_stores` alone was at 95%, peaking at 844%.

System Settings → Spotlight → Search Privacy → **+**, then add:

- `/Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api`
- `~/Library/Developer`
- `~/.gradle`
- `~/.npm`
- `~/Library/Caches/CocoaPods`
- `~/wl-perf`

(`Cmd+Shift+.` shows hidden folders in the picker.)

## 3. Close editors on the build machine

VS Code / Cursor ("Code Helper", 75–85% CPU in the samples) watches and
indexes whatever folder it has open. Close it while builds run.

## Not yet (needs a maintenance window, Phase 1b)

- Move the prod checkout off `~/Desktop`.
- A dedicated APFS volume for builds, with Spotlight and FSEvents logging off.
