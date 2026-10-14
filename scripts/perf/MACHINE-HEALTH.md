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
