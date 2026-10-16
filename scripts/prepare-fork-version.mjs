import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bumpVersion, readMaxTargetVersion } from "./bump-version.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const semverCorePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/u;
const positiveIntegerPattern = /^[1-9]\d*$/u;
const suffixPattern = /^[a-z][a-z0-9-]*$/u;
const upstreamChannels = new Set(["alpha", "beta", "nightly"]);
const repositoryPattern = /^[\w.-]+\/[\w.-]+$/u;

export function deriveForkVersion(currentVersion, suffix, runNumber) {
  const coreMatch = semverCorePattern.exec(currentVersion);
  if (coreMatch === null) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }
  if (!suffixPattern.test(suffix)) {
    throw new Error(
      `DESKTOP_VERSION_SUFFIX must be a lowercase identifier, got ${suffix}.`,
    );
  }
  if (upstreamChannels.has(suffix)) {
    throw new Error(
      `DESKTOP_VERSION_SUFFIX must not be an upstream channel, got ${suffix}.`,
    );
  }
  if (!positiveIntegerPattern.test(runNumber)) {
    throw new Error(
      `GITHUB_RUN_NUMBER must be a positive integer, got ${runNumber}.`,
    );
  }

  const [, major, minor, patch] = coreMatch;
  return `${major}.${minor}.${BigInt(patch) + 1n}-${suffix}.${BigInt(runNumber)}`;
}

async function recordReleaseRepository(repoRoot, repository) {
  const packageJsonPath = join(repoRoot, "packages", "bb-app", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.bbRelease = { repository };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

export async function prepareForkVersion(options) {
  if (!repositoryPattern.test(options.repository)) {
    throw new Error(
      `GITHUB_REPOSITORY must be a GitHub owner/name, got ${options.repository}.`,
    );
  }
  const maxCurrentVersion = await readMaxTargetVersion({
    repoRoot: options.repoRoot,
  });
  const forkVersion = deriveForkVersion(
    maxCurrentVersion,
    options.suffix,
    options.runNumber,
  );

  await bumpVersion({
    args: [forkVersion],
    log: () => {},
    repoRoot: options.repoRoot,
  });
  await recordReleaseRepository(options.repoRoot, options.repository);

  return forkVersion;
}

async function main() {
  const forkVersion = await prepareForkVersion({
    repoRoot: defaultRepoRoot,
    repository: process.env.GITHUB_REPOSITORY ?? "",
    runNumber: process.env.GITHUB_RUN_NUMBER ?? "",
    suffix: process.env.DESKTOP_VERSION_SUFFIX ?? "",
  });

  process.stdout.write(`${forkVersion}\n`);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
