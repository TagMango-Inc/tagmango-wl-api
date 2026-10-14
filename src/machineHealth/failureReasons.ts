/**
 * Buckets a failed task's last log lines into a reason, so failures can be
 * counted by cause. First match wins, so the order matters: a disk-full
 * error often surfaces as a Gradle or Xcode failure too.
 */
const REASONS: [string, RegExp][] = [
  ["Disk full", /no space left|ENOSPC|disk is full|not enough (free )?disk/i],
  ["Apple session expired", /session (has )?expired|re-?authenticat|two-factor|please sign in/i],
  ["Apple program membership", /program membership|agreement|PLA update/i],
  ["Network", /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|could not resolve host|timed out/i],
  ["Signing / provisioning", /provisioning profile|code ?sign|certificate|keychain/i],
  ["CocoaPods", /pod install|cocoapods|podspec/i],
  ["Gradle build", /execution failed for task|FAILURE: Build failed|gradle/i],
  ["Xcode archive", /ARCHIVE FAILED|BUILD FAILED|xcodebuild|gym/i],
  ["Store upload", /google api error|play console|altool|app store connect|upload/i],
];

export const failureReason = (logTail: string) =>
  REASONS.find(([, re]) => re.test(logTail))?.[0] ?? "Other";
