import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const APP_RELEASE_REPOSITORY_ENV_NAME = "BB_APP_RELEASE_REPOSITORY";
export const APP_RELEASE_PROVENANCE_FILE_NAME = "bb-app-release.json";

export const appReleaseRepositorySchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/u, "must be a GitHub owner/name");

const packageJsonReleaseSchema = z
  .object({
    bbRelease: z
      .object({ repository: appReleaseRepositorySchema })
      .strict()
      .optional(),
  })
  .passthrough();

export const appReleaseProvenanceSchema = z
  .object({
    repository: appReleaseRepositorySchema,
    tarballSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    tarballUrl: z.string().url(),
    version: z.string().min(1),
  })
  .strict();
export type AppReleaseProvenance = z.infer<typeof appReleaseProvenanceSchema>;

export interface AppReleaseAssets {
  checksumName: string;
  checksumUrl: string;
  tag: string;
  tarballName: string;
  tarballUrl: string;
}

export function formatAppReleaseAssets(
  repository: string,
  version: string,
): AppReleaseAssets {
  const tag = `desktop-v${version}`;
  const tarballName = `bb-app-${version}.tgz`;
  const checksumName = `${tarballName}.sha256`;
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  return {
    checksumName,
    checksumUrl: `${base}/${checksumName}`,
    tag,
    tarballName,
    tarballUrl: `${base}/${tarballName}`,
  };
}

export function readAppReleaseRepository(packageRoot: string): string | null {
  const parsed = packageJsonReleaseSchema.parse(
    JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
  );
  return parsed.bbRelease?.repository ?? null;
}

export function parseAppReleaseChecksum(
  contents: string,
  tarballName: string,
): string {
  const lines = contents.split("\n").filter((line) => line.trim() !== "");
  if (lines.length !== 1) {
    throw new Error(`Expected one checksum line for ${tarballName}.`);
  }
  const match = /^([0-9a-f]{64}) [ *]?(\S+)$/u.exec(lines[0]!.trim());
  if (match === null || match[2] !== tarballName) {
    throw new Error(`The checksum file does not describe ${tarballName}.`);
  }
  return match[1]!;
}
