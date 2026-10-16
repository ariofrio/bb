import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_RELEASE_PROVENANCE_FILE_NAME } from "@bb/config/app-release";
import { formatAppUpdateVersionsDir } from "@bb/config/app-update";
import {
  formatNpmRevisionInstallDir,
  formatNpmRevisionPackageRoot,
  installNpmRevision,
  isUsableNpmRevision,
  NPM_REVISION_REQUIRED_FILES,
} from "../src/app-update/npm-revision.js";
import type {
  RunCommand,
  RunCommandArgs,
} from "../src/app-update/run-command.js";

const REPOSITORY = "ariofrio/bb";
const VERSION = "0.46.1-ariofrio.8";
const RELEASE_BASE = `https://github.com/${REPOSITORY}/releases/download/desktop-v${VERSION}`;
const TARBALL_NAME = `bb-app-${VERSION}.tgz`;
const TARBALL_URL = `${RELEASE_BASE}/${TARBALL_NAME}`;
const CHECKSUM_URL = `${TARBALL_URL}.sha256`;
const TARBALL_BYTES = Buffer.from("fork tarball bytes");
const TARBALL_SHA256 = createHash("sha256").update(TARBALL_BYTES).digest("hex");

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-fork-"));
  scratchDirs.push(dir);
  return dir;
}

function writePackage(
  packageRoot: string,
  version: string,
  repository: string | null,
): void {
  for (const file of NPM_REVISION_REQUIRED_FILES) {
    mkdirSync(dirname(join(packageRoot, file)), { recursive: true });
    writeFileSync(join(packageRoot, file), "");
  }
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      version,
      ...(repository === null ? {} : { bbRelease: { repository } }),
    }),
  );
}

function writeProvenance(
  dataDir: string,
  overrides: Record<string, string> = {},
) {
  writeFileSync(
    join(
      formatNpmRevisionInstallDir(dataDir, VERSION),
      APP_RELEASE_PROVENANCE_FILE_NAME,
    ),
    JSON.stringify({
      repository: REPOSITORY,
      tarballSha256: TARBALL_SHA256,
      tarballUrl: TARBALL_URL,
      version: VERSION,
      ...overrides,
    }),
  );
}

function fakeNpm(installedRepository: string | null = REPOSITORY) {
  const calls: RunCommandArgs[] = [];
  const installedTarballs: string[] = [];
  const runner: RunCommand = async (call) => {
    calls.push(call);
    if (call.args.includes("install")) {
      const spec = call.args.at(-1) ?? "";
      installedTarballs.push(
        createHash("sha256")
          .update(readFileSync(join(call.cwd, spec)))
          .digest("hex"),
      );
      writePackage(
        join(call.cwd, "node_modules", "bb-app"),
        VERSION,
        installedRepository,
      );
    }
    return { code: 0, outputTail: [], signal: null, stdout: "" };
  };
  return { calls, installedTarballs, runner };
}

function fakeReleaseFetch(
  checksum = `${TARBALL_SHA256}  ${TARBALL_NAME}\n`,
  bytes: Buffer = TARBALL_BYTES,
) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === CHECKSUM_URL) return new Response(checksum);
    if (url === TARBALL_URL) return new Response(new Uint8Array(bytes));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function install(
  dataDir: string,
  npm: ReturnType<typeof fakeNpm>,
  release: ReturnType<typeof fakeReleaseFetch>,
) {
  return installNpmRevision({
    dataDir,
    fetchImpl: release.fetchImpl,
    npmCliPath: null,
    onLine: () => undefined,
    onStep: () => undefined,
    releaseRepository: REPOSITORY,
    runner: npm.runner,
    version: VERSION,
  });
}

describe("installNpmRevision from a fork release", () => {
  it("installs the checksum-verified release tarball instead of the npm registry package", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm();
    const release = fakeReleaseFetch();

    const revision = await install(dataDir, npm, release);

    expect(revision.packageRoot).toBe(
      formatNpmRevisionPackageRoot(dataDir, VERSION),
    );
    expect(release.urls).toEqual([CHECKSUM_URL, TARBALL_URL]);
    const npmInstall = npm.calls.find((call) => call.args.includes("install"));
    expect(npmInstall?.args.at(-1)).toBe(`./${TARBALL_NAME}`);
    expect(
      npm.calls.some((call) =>
        call.args.some((arg) => arg.startsWith("bb-app@")),
      ),
    ).toBe(false);
    expect(npm.installedTarballs).toEqual([TARBALL_SHA256]);
    expect(isUsableNpmRevision(revision, REPOSITORY)).toBe(true);
    expect(
      JSON.parse(
        readFileSync(
          join(
            formatNpmRevisionInstallDir(dataDir, VERSION),
            APP_RELEASE_PROVENANCE_FILE_NAME,
          ),
          "utf8",
        ),
      ),
    ).toEqual({
      repository: REPOSITORY,
      tarballSha256: TARBALL_SHA256,
      tarballUrl: TARBALL_URL,
      version: VERSION,
    });
  });

  it("refuses a tarball whose checksum does not match the release", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm();
    const release = fakeReleaseFetch(undefined, Buffer.from("tampered"));

    await expect(install(dataDir, npm, release)).rejects.toThrow("checksum");
    expect(npm.calls).toEqual([]);
    expect(readdirSync(formatAppUpdateVersionsDir(dataDir))).toEqual([]);
  });

  it("refuses a checksum file for another tarball", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm();
    const release = fakeReleaseFetch(`${TARBALL_SHA256}  bb-app-0.46.1.tgz\n`);

    await expect(install(dataDir, npm, release)).rejects.toThrow(TARBALL_NAME);
    expect(npm.calls).toEqual([]);
  });

  it("fails without falling back to npm when the release cannot be downloaded", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm();
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo EAI_AGAIN github.com");
    }) as unknown as typeof fetch;

    await expect(
      installNpmRevision({
        dataDir,
        fetchImpl,
        npmCliPath: null,
        onLine: () => undefined,
        onStep: () => undefined,
        releaseRepository: REPOSITORY,
        runner: npm.runner,
        version: VERSION,
      }),
    ).rejects.toThrow("EAI_AGAIN");
    expect(npm.calls).toEqual([]);
  });

  it("rejects an installed package that names another release source", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm(null);

    await expect(install(dataDir, npm, fakeReleaseFetch())).rejects.toThrow(
      "release source",
    );
    expect(existsSync(formatNpmRevisionInstallDir(dataDir, VERSION))).toBe(
      false,
    );
  });

  it("reuses a cached install only when its provenance matches this release", async () => {
    const dataDir = scratchDir();
    writePackage(
      formatNpmRevisionPackageRoot(dataDir, VERSION),
      VERSION,
      REPOSITORY,
    );
    writeProvenance(dataDir);
    const npm = fakeNpm();
    const release = fakeReleaseFetch();

    await install(dataDir, npm, release);

    expect(npm.calls).toEqual([]);
    expect(release.urls).toEqual([]);
  });

  it.each([
    [
      "has no provenance",
      (dataDir: string) => {
        writePackage(
          formatNpmRevisionPackageRoot(dataDir, VERSION),
          VERSION,
          REPOSITORY,
        );
      },
    ],
    [
      "came from another repository",
      (dataDir: string) => {
        writePackage(
          formatNpmRevisionPackageRoot(dataDir, VERSION),
          VERSION,
          REPOSITORY,
        );
        writeProvenance(dataDir, { repository: "get-bb/bb" });
      },
    ],
    [
      "is an upstream npm package",
      (dataDir: string) => {
        writePackage(
          formatNpmRevisionPackageRoot(dataDir, VERSION),
          VERSION,
          null,
        );
        writeProvenance(dataDir);
      },
    ],
  ])(
    "reinstalls from the fork when the cached install %s",
    async (_label, seed) => {
      const dataDir = scratchDir();
      seed(dataDir);
      const npm = fakeNpm();
      const release = fakeReleaseFetch();

      const revision = await install(dataDir, npm, release);

      expect(release.urls).toEqual([CHECKSUM_URL, TARBALL_URL]);
      expect(isUsableNpmRevision(revision, REPOSITORY)).toBe(true);
    },
  );
});

describe("isUsableNpmRevision", () => {
  it("keeps upstream installs scoped to upstream packages", () => {
    const dataDir = scratchDir();
    const packageRoot = formatNpmRevisionPackageRoot(dataDir, "0.46.1");
    writePackage(packageRoot, "0.46.1", null);
    const revision = { kind: "npm" as const, packageRoot, version: "0.46.1" };

    expect(isUsableNpmRevision(revision, null)).toBe(true);
    expect(isUsableNpmRevision(revision, REPOSITORY)).toBe(false);
  });

  it("never treats a fork package as an upstream install", () => {
    const dataDir = scratchDir();
    const packageRoot = formatNpmRevisionPackageRoot(dataDir, VERSION);
    writePackage(packageRoot, VERSION, REPOSITORY);
    writeProvenance(dataDir);
    const revision = { kind: "npm" as const, packageRoot, version: VERSION };

    expect(isUsableNpmRevision(revision, null)).toBe(false);
    expect(isUsableNpmRevision(revision, REPOSITORY)).toBe(true);
  });
});
