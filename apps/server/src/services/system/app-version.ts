import type { AppInstallKind } from "@bb/config/app-install";
import semver from "semver";
import { z } from "zod";
import { formatAppReleaseAssets } from "@bb/config/app-release";
import { isNightlyAppVersion } from "@bb/config/app-update";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";

const NPM_REGISTRY_PACKAGE_URL = "https://registry.npmjs.org/bb-app";
const NPM_LATEST_TIMEOUT_MS = 5_000;
const NPM_LATEST_CACHE_TTL_MS = 60 * 60 * 1000;

function resolveDistTag(appVersion: string): "latest" | "nightly" {
  return isNightlyAppVersion(appVersion) ? "nightly" : "latest";
}

const githubReleasesResponseSchema = z.array(
  z
    .object({
      assets: z.array(z.object({ name: z.string() }).passthrough()),
      draft: z.boolean(),
      tag_name: z.string(),
    })
    .passthrough(),
);

function githubUpgradeCommand(repository: string, version: string): string {
  return `npx ${formatAppReleaseAssets(repository, version).tarballUrl}`;
}

const npmLatestResponseSchema = z
  .object({
    version: z.string().min(1),
  })
  .passthrough();

export interface AppVersionService {
  getSystemVersion(
    args?: AppVersionGetSystemVersionArgs,
  ): Promise<SystemVersionResponse>;
}

interface AppVersionGetSystemVersionArgs {
  forceRefresh?: boolean;
}

interface CreateAppVersionServiceArgs {
  installKind: AppInstallKind | null;
  sourceCommit: string | null;
  config: Pick<ServerRuntimeConfig, "appVersion" | "isDevelopment">;
  releaseRepository: string | null;
  fetchImpl?: typeof fetch;
  logger: ServerLogger;
  cacheTtlMs?: number;
  now?: () => number;
}

type NpmDistTag = "latest" | "nightly";

interface LatestRelease {
  upgradeCommand: string;
  version: string;
}

interface LatestReleaseCacheEntry extends LatestRelease {
  cachedAt: number;
}

export function createAppVersionService(
  args: CreateAppVersionServiceArgs,
): AppVersionService {
  const fetchImpl = args.fetchImpl ?? fetch;
  const cacheTtlMs = args.cacheTtlMs ?? NPM_LATEST_CACHE_TTL_MS;
  const now = args.now ?? (() => Date.now());
  const logger = args.logger;
  const config = args.config;
  const installKind = args.installKind;
  const sourceCommit = args.sourceCommit;
  const releaseRepository = args.releaseRepository;
  const distTag = resolveDistTag(config.appVersion);

  let cache: LatestReleaseCacheEntry | null = null;
  let inflight: Promise<LatestRelease | null> | null = null;

  async function fetchGithubLatest(
    repository: string,
  ): Promise<LatestRelease | null> {
    const url = `https://api.github.com/repos/${repository}/releases?per_page=100`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      NPM_LATEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "bb-app-update-check",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, url },
          "Failed to list bb releases from GitHub",
        );
        return null;
      }
      const parsed = githubReleasesResponseSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success) {
        logger.warn(
          { url, issue: parsed.error.message },
          "GitHub releases response did not match expected shape",
        );
        return null;
      }
      let newest: string | null = null;
      for (const release of parsed.data) {
        if (release.draft || !release.tag_name.startsWith("desktop-v")) {
          continue;
        }
        const version = release.tag_name.slice("desktop-v".length);
        if (semver.valid(version) === null) continue;
        const assets = formatAppReleaseAssets(repository, version);
        const names = new Set(release.assets.map((asset) => asset.name));
        if (!names.has(assets.tarballName) || !names.has(assets.checksumName)) {
          continue;
        }
        if (newest === null || semver.gt(version, newest)) newest = version;
      }
      return newest === null
        ? null
        : {
            upgradeCommand: githubUpgradeCommand(repository, newest),
            version: newest,
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ url, error: message }, "GitHub release lookup failed");
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function fetchNpmDistTag(tag: NpmDistTag): Promise<string | null> {
    const npmDistTagUrl = `${NPM_REGISTRY_PACKAGE_URL}/${tag}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      NPM_LATEST_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(npmDistTagUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status, url: npmDistTagUrl },
          "Failed to fetch latest bb-app version from npm",
        );
        return null;
      }
      const json = await response.json();
      const parsed = npmLatestResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { url: npmDistTagUrl, issue: parsed.error.message },
          "npm latest response did not match expected shape",
        );
        return null;
      }
      return parsed.data.version;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        { url: npmDistTagUrl, error: message },
        "npm latest lookup failed",
      );
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function fetchNpmLatest(): Promise<LatestRelease | null> {
    if (distTag === "latest") {
      const version = await fetchNpmDistTag("latest");
      return version === null
        ? null
        : { upgradeCommand: "npx bb-app@latest", version };
    }
    const [nightly, latest] = await Promise.all([
      fetchNpmDistTag("nightly"),
      fetchNpmDistTag("latest"),
    ]);
    if (
      latest !== null &&
      semver.valid(latest) !== null &&
      (nightly === null ||
        semver.valid(nightly) === null ||
        semver.gt(latest, nightly))
    ) {
      return { upgradeCommand: "npx bb-app@latest", version: latest };
    }
    return nightly === null
      ? null
      : { upgradeCommand: "npx bb-app@nightly", version: nightly };
  }

  async function getLatestVersion(args?: {
    forceRefresh?: boolean;
  }): Promise<LatestRelease | null> {
    const currentTime = now();
    if (
      args?.forceRefresh !== true &&
      cache !== null &&
      currentTime - cache.cachedAt < cacheTtlMs
    ) {
      return cache;
    }
    if (inflight !== null) {
      return inflight;
    }
    const requestPromise = (async () => {
      const result =
        releaseRepository === null
          ? await fetchNpmLatest()
          : await fetchGithubLatest(releaseRepository);
      if (result !== null) {
        cache = { ...result, cachedAt: now() };
      }
      return result;
    })();
    inflight = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (inflight === requestPromise) {
        inflight = null;
      }
    }
  }

  return {
    async getSystemVersion(
      args: AppVersionGetSystemVersionArgs = {},
    ): Promise<SystemVersionResponse> {
      const baseResponse: SystemVersionResponse = {
        currentCommit: installKind === "source" ? sourceCommit : null,
        installKind,
        currentVersion: config.appVersion,
        latestVersion: null,
        source: releaseRepository === null ? "npm" : "github",
        updateAvailable: false,
        isDevelopment: config.isDevelopment,
        upgradeCommand:
          releaseRepository === null
            ? `npx bb-app@${distTag}`
            : githubUpgradeCommand(releaseRepository, config.appVersion),
      };

      if (config.isDevelopment || installKind === "source") {
        return baseResponse;
      }

      const release = await getLatestVersion({
        forceRefresh: args.forceRefresh,
      });
      if (release === null) {
        return baseResponse;
      }
      const latestVersion = release.version;
      const releaseResponse: SystemVersionResponse = {
        ...baseResponse,
        latestVersion,
        upgradeCommand: release.upgradeCommand,
      };

      const parsedCurrent = semver.parse(config.appVersion);
      const parsedLatest = semver.parse(latestVersion);
      if (parsedCurrent === null || parsedLatest === null) {
        logger.warn(
          {
            currentVersion: config.appVersion,
            latestVersion,
          },
          "Skipping update check because a version is not valid semver",
        );
        return releaseResponse;
      }

      return {
        ...releaseResponse,
        updateAvailable: semver.gt(parsedLatest, parsedCurrent),
      };
    },
  };
}
