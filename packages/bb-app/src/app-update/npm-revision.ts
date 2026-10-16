import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import semver from "semver";
import { z } from "zod";
import {
  APP_RELEASE_PROVENANCE_FILE_NAME,
  appReleaseProvenanceSchema,
  formatAppReleaseAssets,
  parseAppReleaseChecksum,
  readAppReleaseRepository,
  type AppReleaseProvenance,
} from "@bb/config/app-release";
import {
  formatAppUpdateVersionsDir,
  type NpmAppRevision,
} from "@bb/config/app-update";
import { runCheckedCommand, type RunCommand } from "./run-command.js";
import { isSamePath } from "./shim-support.js";

const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const RELEASE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const NATIVE_CHECK_TIMEOUT_MS = 60 * 1000;
const NATIVE_INSTALL_SCRIPT_PACKAGES = [
  "better-sqlite3",
  "node-pty",
  "@parcel/watcher",
] as const;
const NATIVE_MODULE_CHECK = [
  "const Database = require('better-sqlite3');",
  "new Database(':memory:').close();",
  "require('node-pty');",
].join("");

const packageJsonSchema = z
  .object({ version: z.string().min(1) })
  .passthrough();

export const NPM_REVISION_REQUIRED_FILES = [
  join("dist", "bb-app.js"),
  join("server", "dist", "index.js"),
  join("host-daemon", "dist", "daemon-bundle.mjs"),
  join("app", "dist", "index.html"),
] as const;

export function readPackageVersion(packageRoot: string): string | null {
  try {
    const parsed = packageJsonSchema.safeParse(
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
    );
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

function isCompleteNpmRevision(revision: NpmAppRevision): boolean {
  return (
    readPackageVersion(revision.packageRoot) === revision.version &&
    NPM_REVISION_REQUIRED_FILES.every((file) =>
      existsSync(join(revision.packageRoot, file)),
    )
  );
}

function readRevisionReleaseRepository(
  packageRoot: string,
): string | null | undefined {
  try {
    return readAppReleaseRepository(packageRoot);
  } catch {
    return undefined;
  }
}

function readRevisionProvenance(
  revision: NpmAppRevision,
): AppReleaseProvenance | null {
  try {
    return appReleaseProvenanceSchema.parse(
      JSON.parse(
        readFileSync(
          join(
            dirname(dirname(revision.packageRoot)),
            APP_RELEASE_PROVENANCE_FILE_NAME,
          ),
          "utf8",
        ),
      ),
    );
  } catch {
    return null;
  }
}

function matchesReleaseSource(
  revision: NpmAppRevision,
  releaseRepository: string | null,
): boolean {
  if (
    readRevisionReleaseRepository(revision.packageRoot) !== releaseRepository
  ) {
    return false;
  }
  if (releaseRepository === null) return true;
  const provenance = readRevisionProvenance(revision);
  return (
    provenance !== null &&
    provenance.repository === releaseRepository &&
    provenance.version === revision.version &&
    provenance.tarballUrl ===
      formatAppReleaseAssets(releaseRepository, revision.version).tarballUrl
  );
}

export function isUsableNpmRevision(
  revision: NpmAppRevision,
  releaseRepository: string | null,
): boolean {
  return (
    isCompleteNpmRevision(revision) &&
    matchesReleaseSource(revision, releaseRepository)
  );
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const timeout = AbortSignal.timeout(RELEASE_DOWNLOAD_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  });
  if (!response.ok) {
    throw new Error(
      `Downloading ${url} failed with HTTP ${String(response.status)}.`,
    );
  }
  return response;
}

async function downloadReleaseTarball(args: {
  fetchImpl: typeof fetch;
  repository: string;
  signal: AbortSignal | undefined;
  stagingDir: string;
  version: string;
}): Promise<{ provenance: AppReleaseProvenance; spec: string }> {
  const assets = formatAppReleaseAssets(args.repository, args.version);
  const expectedSha256 = parseAppReleaseChecksum(
    await (
      await fetchWithTimeout(args.fetchImpl, assets.checksumUrl, args.signal)
    ).text(),
    assets.tarballName,
  );
  const bytes = Buffer.from(
    await (
      await fetchWithTimeout(args.fetchImpl, assets.tarballUrl, args.signal)
    ).arrayBuffer(),
  );
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${assets.tarballName} does not match its release checksum (expected ${expectedSha256}, got ${actualSha256}).`,
    );
  }
  await writeFile(join(args.stagingDir, assets.tarballName), bytes);
  return {
    provenance: {
      repository: args.repository,
      tarballSha256: actualSha256,
      tarballUrl: assets.tarballUrl,
      version: args.version,
    },
    spec: `./${assets.tarballName}`,
  };
}

export function formatNpmRevisionInstallDir(
  dataDir: string,
  version: string,
): string {
  return join(formatAppUpdateVersionsDir(dataDir), version);
}

export function formatNpmRevisionPackageRoot(
  dataDir: string,
  version: string,
): string {
  return join(
    formatNpmRevisionInstallDir(dataDir, version),
    "node_modules",
    "bb-app",
  );
}

export function resolveNpmCliPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return join(
      dirname(require.resolve("npm/package.json")),
      "bin",
      "npm-cli.js",
    );
  } catch {
    return null;
  }
}

function createInstallEnv(): NodeJS.ProcessEnv {
  const executableDirectory = dirname(process.execPath);
  const inheritedPath = process.env.PATH;
  return {
    ...process.env,
    PATH: inheritedPath
      ? `${executableDirectory}${delimiter}${inheritedPath}`
      : executableDirectory,
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

export interface InstallNpmRevisionArgs {
  dataDir: string;
  fetchImpl?: typeof fetch;
  npmCliPath: string | null;
  onLine: (line: string) => void;
  onStep: (step: string) => void;
  releaseRepository: string | null;
  runner: RunCommand;
  signal?: AbortSignal;
  version: string;
}

export async function installNpmRevision(
  args: InstallNpmRevisionArgs,
): Promise<NpmAppRevision> {
  args.signal?.throwIfAborted();
  if (semver.valid(args.version) === null) {
    throw new Error(
      `Refusing to install invalid bb-app version ${args.version}`,
    );
  }
  const installDir = formatNpmRevisionInstallDir(args.dataDir, args.version);
  const revision: NpmAppRevision = {
    kind: "npm",
    packageRoot: formatNpmRevisionPackageRoot(args.dataDir, args.version),
    version: args.version,
  };
  if (isUsableNpmRevision(revision, args.releaseRepository)) {
    return revision;
  }

  const versionsDir = formatAppUpdateVersionsDir(args.dataDir);
  const stagingDir = join(
    versionsDir,
    `.staging-${args.version}-${String(process.pid)}`,
  );
  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(stagingDir, { recursive: true });
  await writeFile(
    join(stagingDir, "package.json"),
    `${JSON.stringify(
      {
        allowScripts: Object.fromEntries(
          NATIVE_INSTALL_SCRIPT_PACKAGES.map((name) => [name, true]),
        ),
        name: "bb-app-install",
        private: true,
      },
      null,
      2,
    )}\n`,
  );

  const env = createInstallEnv();
  const npmCommand =
    args.npmCliPath === null
      ? { args: [] as string[], command: "npm" }
      : { args: [args.npmCliPath], command: process.execPath };
  try {
    args.signal?.throwIfAborted();
    args.onStep(`Downloading bb-app ${args.version}`);
    let spec = `bb-app@${args.version}`;
    if (args.releaseRepository !== null) {
      const download = await downloadReleaseTarball({
        fetchImpl: args.fetchImpl ?? fetch,
        repository: args.releaseRepository,
        signal: args.signal,
        stagingDir,
        version: args.version,
      });
      spec = download.spec;
      await writeFile(
        join(stagingDir, APP_RELEASE_PROVENANCE_FILE_NAME),
        `${JSON.stringify(download.provenance, null, 2)}\n`,
      );
    }
    await runCheckedCommand(args.runner, "npm install", {
      args: [
        ...npmCommand.args,
        "install",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        spec,
      ],
      command: npmCommand.command,
      cwd: stagingDir,
      env,
      onLine: args.onLine,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
      timeoutMs: NPM_INSTALL_TIMEOUT_MS,
    });
    args.signal?.throwIfAborted();
    await rm(installDir, { force: true, recursive: true });
    await rename(stagingDir, installDir);
  } catch (error) {
    await rm(stagingDir, { force: true, recursive: true });
    throw error;
  }

  try {
    args.signal?.throwIfAborted();
    args.onStep(`Verifying bb-app ${args.version}`);
    if (!isCompleteNpmRevision(revision)) {
      throw new Error(
        `The downloaded bb-app ${args.version} package is incomplete or reports a different version.`,
      );
    }
    if (!matchesReleaseSource(revision, args.releaseRepository)) {
      throw new Error(
        `The downloaded bb-app ${args.version} package does not come from this bb's release source (${args.releaseRepository ?? "npm"}).`,
      );
    }
    await runCheckedCommand(args.runner, "Native module check", {
      args: ["-e", NATIVE_MODULE_CHECK],
      command: process.execPath,
      cwd: revision.packageRoot,
      env,
      onLine: args.onLine,
      ...(args.signal === undefined ? {} : { signal: args.signal }),
      timeoutMs: NATIVE_CHECK_TIMEOUT_MS,
    });
  } catch (error) {
    await rm(installDir, { force: true, recursive: true });
    throw error;
  }
  return revision;
}

export async function pruneNpmRevisions(args: {
  dataDir: string;
  keepPackageRoots: readonly string[];
}): Promise<void> {
  const versionsDir = formatAppUpdateVersionsDir(args.dataDir);
  let entries: string[];
  try {
    entries = await readdir(versionsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const installDir = join(versionsDir, entry);
    const packageRoot = join(installDir, "node_modules", "bb-app");
    if (args.keepPackageRoots.some((root) => isSamePath(root, packageRoot))) {
      continue;
    }
    if (
      entry.startsWith(".staging-") &&
      entry.endsWith(`-${String(process.pid)}`)
    ) {
      continue;
    }
    await rm(installDir, { force: true, recursive: true });
  }
}
