/**
 * Fails the build task when the built app has no JS bundle.
 *
 * A Metro crash inside the Xcode archive is only a warning: the app's bundle
 * phase runs react-native-xcode.sh under sentry-cli with SENTRY_ALLOW_FAILURE.
 * So the archive "succeeds" and an app that never gets past its launch screen
 * goes to the store. consciouslifehub and starda 10.0.1 shipped like that on
 * 17-18 Oct (ENOTEMPTY on a shared metro-cache, before per-workspace TMPDIR).
 * Checking the artifact here covers every branch of the app, including the
 * ones without the build-phase fix.
 */

// a real bundle is ~13 MB; anything this small is not a working app
const MIN_BUNDLE_BYTES = 1_000_000;

const ARTIFACTS = {
  // gym exports the .ipa into the project folder; the newest one is this build's
  ios: { glob: "*.ipa(Nom[1])", entry: "^Payload/[^/]+[.]app/main[.]jsbundle$" },
  android: {
    glob: "android/app/build/outputs/bundle/release/app-release.aab(N)",
    entry: "^base/assets/index[.]android[.]bundle$",
  },
} as const;

/** zsh, run from the app folder after the platform's fastlane build */
export const verifyJsBundleCommand = (platform: "ios" | "android") => {
  const { glob, entry } = ARTIFACTS[platform];
  return [
    `{ f=(${glob});`,
    `[[ -n $f ]] || { echo "error: no ${platform} build artifact found to check for a JS bundle"; exit 1; };`,
    `s=$(unzip -l $f | awk -v re='${entry}' '$4 ~ re {print $1}');`,
    `if [[ -z $s || $s -lt ${MIN_BUNDLE_BYTES} ]]; then echo "error: $f has no JS bundle (size: \${s:-missing}). Bundling failed during the build; see the warnings above. Not uploading."; exit 1; fi;`,
    `echo "JS bundle OK: $s bytes in $f"; }`,
  ].join(" ");
};
