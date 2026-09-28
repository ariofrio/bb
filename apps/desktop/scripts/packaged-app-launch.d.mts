export const LINUX_DISABLE_SANDBOX_ARGUMENT: "--no-sandbox";
export const MACOS_MOCK_KEYCHAIN_ARGUMENT: "--use-mock-keychain";

export interface PackagedAppLaunchArgumentsArgs {
  platform: NodeJS.Platform;
  userDataDir: string;
}

export function createPackagedAppLaunchArguments(
  args: PackagedAppLaunchArgumentsArgs,
): string[];
