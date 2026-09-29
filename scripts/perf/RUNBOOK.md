# Phase 0 runbook (Mac Studio)

Collects the "before" numbers. Nothing here changes how builds run, and it is
safe while bulk redeploys are running.

## Run (after the Phase 0 PR is merged to main)

```sh
(git clone -q git@github.com:TagMango-Inc/tagmango-wl-api.git ~/wl-perf/src 2>/dev/null || git -C ~/wl-perf/src pull -q) && zsh ~/wl-perf/src/scripts/perf/phase0.sh
```

It uses a separate clone in `~/wl-perf/src` so the prod folder is only
touched by the deploy step. `phase0.sh` then:

1. Writes a machine snapshot to `~/wl-perf/snapshot-<time>.txt` (read-only,
   takes a few minutes, contains no secrets).
2. Starts the host sampler under pm2 as `wl-perf-sampler`. It writes one line
   every 30s to `~/wl-perf/host/`.
3. Deploys the worker timing change:
   - pauses the build queue and waits for the running build to finish;
   - stops `tagmango-worker`;
   - fast-forwards prod `main` and runs `npm run build`;
   - starts the worker and resumes the queue.

   The last two happen even if something fails. If the build fails, it
   rolls back to the previous commit and rebuilds.

The deploy step refuses to run, before pausing anything, if:
- prod is not on `main`;
- prod has uncommitted changes to tracked files;
- `main` carries changes other than Phase 0's.

Running it again is safe. It skips the deploy once it is done.

Output goes to `~/wl-perf/phase0-<time>.log`. The pm2 app name defaults to
`tagmango-worker`, and the prod path to
`/Users/kylixmedusa/Desktop/TagMango/tagmango-wl-api` (override with
`WL_REPO=...`).

## Then

- Send back the snapshot file.
- Change nothing else on the machine for about 3 days (aim for 50+
  deployments per platform).
- Run `zsh ~/wl-perf/src/scripts/perf/phase0.sh report` and send back
  `~/wl-perf/host-before.json`. Per-command timings are read from Mongo
  directly.
