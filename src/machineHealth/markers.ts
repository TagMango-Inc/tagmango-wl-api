/**
 * Changes from the build-performance plan, drawn as markers on the Machine
 * Health charts so each one's before/after is visible. Times are PR merges;
 * prod picks a change up when it next pulls main.
 */
export const PLAN_MARKERS: { t: string; label: string }[] = [
  { t: "2026-09-28T16:47:30Z", label: "wl-api #38 · clean up old deployment folders" },
  { t: "2026-09-29T14:27:28Z", label: "wl-api #39 · Phase 0: per-task timings" },
  { t: "2026-10-05T16:51:38Z", label: "wl-api #42/#43 · Phase 1: disk guard, background deletes, Spotlight" },
  { t: "2026-10-07T05:24:14Z", label: "wl-api #44 · Phase 2: npm --prefer-offline" },
  { t: "2026-10-07T05:49:57Z", label: "TagMangoApp #316 · Phase 2: Gradle cache, 2 ABIs, no clean" },
  { t: "2026-10-07T06:21:09Z", label: "TagMangoApp #317 · match renews expired profiles" },
  { t: "2026-10-09T13:45:09Z", label: "wl-api #46 · Phase 3: shared gems, keep Xcode caches" },
  { t: "2026-10-09T13:51:04Z", label: "TagMangoApp #321 · Xcode compilation cache (reverted)" },
  { t: "2026-10-09T14:30:47Z", label: "TagMangoApp #322 · revert #321" },
  { t: "2026-10-09T16:47:41Z", label: "wl-api #47 · skip unchanged screenshots" },
  { t: "2026-10-12T07:40:15Z", label: "wl-api #49 · cap Xcode caches, hourly cleanup" },
];
