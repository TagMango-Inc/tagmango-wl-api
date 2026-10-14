// Two build lanes run in the worker process, one job each: buildQueue (iOS,
// and Android while the Android lane is off) and androidBuildQueue. Each
// deployment has its own workspace (deployments/<bundle>-<platform>); these
// cover what the lanes still share.

/** runs one task at a time across both lanes, in the order they ask */
export const takingTurns = () => {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const turn = last.then(run, run);
    last = turn.catch(() => undefined);
    return turn;
  };
};

/** root/<repo> is reset and fetched by the first task of every deployment and
 *  copied by the second; at the same time, git's index.lock collides */
export const withRootRepo = takingTurns();

/** screenshot generation runs Detox on the iOS simulator for both platforms
 *  and shuts every simulator down when it ends */
export const withSimulator = takingTurns();
