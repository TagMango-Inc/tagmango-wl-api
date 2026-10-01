```
npm install
npm run dev
```

```
open http://localhost:3000
```

## Deploying on the build machine

```
npm run redeploy              # pull, build, reload pm2
npm run redeploy -- --no-pull # rebuild and reload what is checked out
```

Pauses the job queues and waits for running builds to finish before touching
the code, then resumes them, so a deploy never kills a build. Queue control on
its own: `node scripts/queue.js status|pause|resume|wait-idle`.
