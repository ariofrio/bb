export const LINUX_DISABLE_SANDBOX_ARGUMENT = "--no-sandbox";
export const MACOS_MOCK_KEYCHAIN_ARGUMENT = "--use-mock-keychain";

export function createPackagedAppLaunchArguments({ platform, userDataDir }) {
  const platformArguments =
    platform === "linux"
      ? [LINUX_DISABLE_SANDBOX_ARGUMENT]
      : platform === "darwin"
        ? [MACOS_MOCK_KEYCHAIN_ARGUMENT]
        : [];
  return [...platformArguments, `--user-data-dir=${userDataDir}`];
}
