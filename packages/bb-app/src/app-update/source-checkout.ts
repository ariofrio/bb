import { z } from "zod";
import type {
  AppUpdateBlockReason,
  SourceAppRevision,
  SourceUpdateCheck,
} from "@bb/config/app-update";
import { runCheckedCommand, type RunCommand } from "./run-command.js";

const DEFAULT_SOURCE_BRANCH = "main";
const SOURCE_REMOTE = "origin";
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const INCOMING_SUBJECT_LIMIT = 20;
const BB_APP_PACKAGE_JSON_PATH = "packages/bb-app/package.json";

const packageJsonSchema = z
  .object({ version: z.string().min(1) })
  .passthrough();

interface SourceGitArgs {
  repoRoot: string;
  runner: RunCommand;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(
  args: SourceGitArgs,
  gitArgs: string[],
  timeoutMs?: number,
): Promise<string> {
  const result = await runCheckedCommand(
    args.runner,
    `git ${gitArgs[0] ?? ""}`,
    {
      args: gitArgs,
      command: "git",
      cwd: args.repoRoot,
      env: gitEnv(),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  );
  return result.stdout.trim();
}

async function tryGit(
  args: SourceGitArgs,
  gitArgs: string[],
): Promise<string | null> {
  const result = await args.runner({
    args: gitArgs,
    command: "git",
    cwd: args.repoRoot,
    env: gitEnv(),
  });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function readSourceFileAt(
  args: SourceGitArgs & { commit: string; path: string },
): Promise<string | null> {
  return tryGit(args, ["show", `${args.commit}:${args.path}`]);
}

async function readVersionAt(
  args: SourceGitArgs & { commit: string },
): Promise<string> {
  const raw = await readSourceFileAt({
    ...args,
    path: BB_APP_PACKAGE_JSON_PATH,
  });
  if (raw === null) return "unknown";
  try {
    const parsed = packageJsonSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function readSourceRevision(
  args: SourceGitArgs,
): Promise<SourceAppRevision> {
  const commit = await git(args, ["rev-parse", "HEAD"]);
  return {
    commit,
    kind: "source",
    version: await readVersionAt({ ...args, commit }),
  };
}

async function readSourceBranch(args: SourceGitArgs): Promise<string> {
  const remoteHead = await tryGit(args, [
    "symbolic-ref",
    "--quiet",
    "--short",
    `refs/remotes/${SOURCE_REMOTE}/HEAD`,
  ]);
  const prefix = `${SOURCE_REMOTE}/`;
  if (remoteHead === null || !remoteHead.startsWith(prefix)) {
    return DEFAULT_SOURCE_BRANCH;
  }
  return remoteHead.slice(prefix.length);
}

function blocked(reason: AppUpdateBlockReason, message: string) {
  return { message, reason };
}

async function readLocalBlock(
  args: SourceGitArgs & { sourceBranch: string },
): Promise<SourceUpdateCheck["blocked"]> {
  const branch = await tryGit(args, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (branch === null) {
    return blocked(
      "detached-head",
      `The checkout is on a detached HEAD. Check out ${args.sourceBranch} to update from the app.`,
    );
  }
  if (branch !== args.sourceBranch) {
    return blocked(
      "not-on-main",
      `The checkout is on ${branch}. Only ${args.sourceBranch} can be updated from the app.`,
    );
  }
  const status = await git(args, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  if (status !== "") {
    return blocked(
      "uncommitted-changes",
      "The working tree has uncommitted changes. Commit or stash them to update from the app.",
    );
  }
  return null;
}

export async function inspectSourceCheckout(
  args: SourceGitArgs & { fetch: boolean },
): Promise<SourceUpdateCheck> {
  const current = await readSourceRevision(args);
  const sourceBranch = await readSourceBranch(args);
  const upstreamRef = `${SOURCE_REMOTE}/${sourceBranch}`;
  const localBlock = await readLocalBlock({ ...args, sourceBranch });
  if (args.fetch && localBlock?.reason !== "detached-head") {
    const fetchResult = await args.runner({
      args: ["fetch", "--quiet", SOURCE_REMOTE, sourceBranch],
      command: "git",
      cwd: args.repoRoot,
      env: gitEnv(),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    if (fetchResult.code !== 0) {
      return {
        blocked: blocked(
          "fetch-failed",
          `Could not fetch ${upstreamRef}: ${fetchResult.outputTail.at(-1) ?? "git fetch failed"}`,
        ),
        current,
        incoming: null,
      };
    }
  }

  const upstream = await tryGit(args, [
    "rev-parse",
    "--verify",
    "--quiet",
    upstreamRef,
  ]);
  if (upstream === null) {
    return { blocked: localBlock, current, incoming: null };
  }
  const counts = await git(args, [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${upstreamRef}`,
  ]);
  const [aheadText, behindText] = counts.split(/\s+/u);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  if (!Number.isInteger(behind) || behind === 0) {
    return { blocked: localBlock, current, incoming: null };
  }
  const subjects = (
    await git(args, [
      "log",
      "--format=%s",
      `-n${String(INCOMING_SUBJECT_LIMIT)}`,
      `HEAD..${upstreamRef}`,
    ])
  )
    .split("\n")
    .filter((line) => line.trim() !== "");
  return {
    blocked:
      localBlock ??
      (Number.isInteger(ahead) && ahead > 0
        ? blocked(
            "diverged",
            `Local ${sourceBranch} has ${String(ahead)} commit${ahead === 1 ? "" : "s"} that ${upstreamRef} does not. Push or reset them to update from the app.`,
          )
        : null),
    current,
    incoming: {
      commit: upstream,
      commitCount: behind,
      subjects,
      version: await readVersionAt({ ...args, commit: upstream }),
    },
  };
}

export async function fastForwardSource(
  args: SourceGitArgs & { from: string; to: string },
): Promise<void> {
  const block = await readLocalBlock({
    ...args,
    sourceBranch: await readSourceBranch(args),
  });
  if (block !== null) {
    throw new Error(block.message);
  }
  const head = await git(args, ["rev-parse", "HEAD"]);
  if (head !== args.from) {
    throw new Error(
      `The checkout moved to ${head.slice(0, 12)} after the update was requested.`,
    );
  }
  await git(args, ["merge", "--ff-only", "--quiet", args.to]);
}
