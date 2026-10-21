# Machine Health sampler (Mac Studio)

Feeds the dashboard's **Machine Health** tab. It records CPU (grouped by what
the work is for), memory, swap, free disk and disk I/O every 30s. Every 30 min
it also records folder sizes, booted simulators, Gradle daemons and pm2
status. Readings go to the `wlmachinehealth` collection, which a TTL index
empties after 30 days (~90k small documents). It only reads from the machine.

It replaces `wl-perf-sampler` (scripts/perf/host-sampler.js), which wrote to
`~/wl-perf/host/*.jsonl`.

## Start (after this PR is merged and prod has pulled + built)

Add an app to the prod `ecosystem.config.js` with the same `env` block as
`tagmango-worker` (it only needs `MONGO_URI`):

```js
{
  name: "tagmango-machine-health",
  script: "dist/src/machineHealth/sampler.js",
  instances: 1,          // each instance would write its own readings
  exec_mode: "fork",
  autorestart: true,
  watch: false,
  env: { NODE_ENV: "production", MONGO_URI: "<same as tagmango-worker>" },
},
```

Then, from the prod folder:

```sh
pm2 start ecosystem.config.js --only tagmango-machine-health
pm2 save
pm2 delete wl-perf-sampler   # old file-based sampler, no longer needed
pm2 save
```

The API (`tagmango-api`) must be running the new build for the tab to load.
It restarts on its own because it runs with `watch: true`.

## Check

```sh
pm2 logs tagmango-machine-health --lines 5
# expect: "machine health: sampling every 30s, scanning folders every 30 min"
```

The tab shows "Last reading Ns ago" at the top right. The first folder scan
runs at start-up and can take a few minutes at background priority.

## Knobs

- `WL_HEALTH_SCAN_MIN`: minutes between folder scans (default 30).
- Folders, process groups and plan markers: `src/machineHealth/config.ts`
  and `src/machineHealth/markers.ts`.

## What keeps each folder from growing

| Folder | Removed by | Kept |
|---|---|---|
| `deployments/<bundle>-<platform>` | worker after a successful deploy; hourly cron | `DEPLOYMENT_FOLDER_RETENTION_HOURS` |
| DerivedData project folders, gym logs | worker after an iOS deploy; hourly cron | 1 h; gym logs 3 days |
| Xcode `*.noindex` caches | worker, before each iOS job | capped at `WL_XCODE_CACHE_MAX_GB` |
| Xcode Archives | worker after a successful iOS deploy (all archives: gym already exported the .ipa); hourly cron per `.xcarchive` | 1 h |
| CocoaPods `Pods/External` (hermes-engine, React-Core-prebuilt, ReactNativeDependencies) | hourly cron (`trashStaleExternalPods`) | `EXTERNAL_POD_CACHE_RETENTION_DAYS` (2) |
| Gradle build cache (`~/.gradle/caches/build-cache-1`) | Gradle itself, once a day when a daemon stops | `GRADLE_BUILD_CACHE_RETENTION_DAYS` (2), set by `~/.gradle/init.d/wl-build-cache-retention.gradle`, which the worker writes on start |
| Shared gems | hourly cron | `GEM_CACHE_RETENTION_DAYS` (14) unused |
| AAB outputs | daily cron | `AAB_RETENTION_HOURS` |

CocoaPods gives every pod whose podspec comes from a local path a separate
cache entry per workspace path and never removes any: hermes-engine alone
reached 1,255 copies (111 GB) by 21 Oct 2026. A pod install that finds no
entry downloads the tarball again (27 MB).

Gradle can't cap its build cache by size, only by days since last use. Entries
shared across apps (about 46% of tasks come from the cache) are used by every
Android build and stay; per-app entries go after 2 days. After 2+ days without
an Android build, the first one runs without them, about 2 minutes slower.

Retention constants are in `src/constants/index.ts`.
