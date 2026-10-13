import { IosPipeline } from "../utils/iosDeployment";

/**
 * Task 6 on a first iOS deployment: register the app and its notification
 * extension with Apple (and App Store Connect). The two pipelines only differ
 * here and in the appGroups argument to app-build.js.
 */
export const iosCreateAppCommands = (
  pipeline: IosPipeline,
  bundle: string,
): string[] => {
  const nse = `${bundle}.OneSignalNotificationServiceExtension`;
  const group = `group.${bundle}.onesignal`;

  if (pipeline === "ios-standard") {
    return [
      // creates both identifiers without the App Groups capability; skips existing ones
      `source ~/.zshrc && bundle exec fastlane ios create`,
    ];
  }

  return [
    // creates both identifiers with the App Groups capability; skips existing ones
    `source ~/.zshrc && bundle exec fastlane ios create_with_app_groups`,
    // create app group for ios bundle, skips if already created
    `source ~/.zshrc && bundle exec fastlane produce group -g ${group} -n "group ${bundle.split(".").join(" ")} onesignal"`,
    // associate bundle with app group, skips if already associated
    `source ~/.zshrc && bundle exec fastlane produce associate_group -a ${bundle} ${group}`,
    // associate bundle with app group, skips if already associated
    `source ~/.zshrc && bundle exec fastlane produce associate_group -a ${nse} ${group}`,
  ];
};
