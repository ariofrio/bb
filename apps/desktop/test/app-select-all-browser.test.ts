import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { build, type OutputFile } from "esbuild";
import { expect, it } from "vitest";

const require = createRequire(__filename);
const electronBinary = require("electron") as string;
const desktopRoot = resolve(__dirname, "..");
const appRoot = resolve(desktopRoot, "../app");
const fixtureEntry = resolve(appRoot, "fixtures/app-select-all-browser.tsx");
const TIMEOUT_MS = 15_000;

interface BrowserSelectionResults {
  chrome: string;
  editorPrevented: boolean;
  iframePrevented: boolean;
  main: string;
  mainPrevented: boolean;
  shadow: string;
  shadowPrevented: boolean;
}

function outputByExtension(
  outputFiles: readonly OutputFile[],
  extension: string,
): OutputFile {
  const output = outputFiles.find((file) => file.path.endsWith(extension));
  if (output === undefined) {
    throw new Error(`Missing ${extension} browser fixture output`);
  }
  return output;
}

async function stopElectron(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function waitForBrowserResult(args: {
  child: ChildProcessWithoutNullStreams;
  result: Promise<BrowserSelectionResults>;
  stderr: string[];
  stdout: string[];
}): Promise<BrowserSelectionResults> {
  return await new Promise<BrowserSelectionResults>(
    (resolvePromise, rejectPromise) => {
      const cleanup = () => {
        clearTimeout(timeout);
        args.child.off("exit", handleExit);
      };
      const handleExit = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ) => {
        cleanup();
        rejectPromise(
          new Error(
            `Electron exited before reporting selection results: code=${String(code)} signal=${String(signal)}.\n${args.stdout.join("")}\n${args.stderr.join("")}`,
          ),
        );
      };
      const timeout = setTimeout(() => {
        cleanup();
        rejectPromise(
          new Error(
            `Timed out waiting for Chromium selection results.\n${args.stdout.join("")}\n${args.stderr.join("")}`,
          ),
        );
      }, TIMEOUT_MS);
      args.child.once("exit", handleExit);
      args.result.then(
        (result) => {
          cleanup();
          resolvePromise(result);
        },
        (error: unknown) => {
          cleanup();
          rejectPromise(error);
        },
      );
    },
  );
}

it("enforces scoped Select All in real Chromium", async () => {
  const buildResult = await build({
    absWorkingDir: appRoot,
    alias: { "@": resolve(appRoot, "src") },
    bundle: true,
    conditions: ["style"],
    entryPoints: [fixtureEntry],
    format: "iife",
    jsx: "automatic",
    loader: { ".woff2": "dataurl" },
    nodePaths: [resolve(appRoot, "node_modules")],
    outdir: "browser-fixture",
    platform: "browser",
    write: false,
  });
  const script = outputByExtension(buildResult.outputFiles, ".js");
  const stylesheet = outputByExtension(buildResult.outputFiles, ".css");
  const scratchRoot = await mkdtemp(join(tmpdir(), "bb-select-all-browser-"));
  const mainPath = join(scratchRoot, "main.cjs");
  await writeFile(
    mainPath,
    `const { app, BrowserWindow } = require("electron");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  await window.loadURL(process.env.BB_SELECT_ALL_FIXTURE_URL);
});
app.on("window-all-closed", () => app.quit());
`,
  );

  let resolveResult: (result: BrowserSelectionResults) => void = () => {};
  let rejectResult: (error: Error) => void = () => {};
  const resultPromise = new Promise<BrowserSelectionResults>(
    (resolvePromise, rejectPromise) => {
      resolveResult = resolvePromise;
      rejectResult = rejectPromise;
    },
  );
  const server = createServer((request, response: ServerResponse) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/fixture.css">
<aside id="chrome">SIDEBAR CHROME</aside>
<main id="main-scope" class="select-text" data-select-all-scope>
  <p>MAIN FIRST</p><button>MAIN ACTION</button><p>MAIN LAST</p>
</main>
<section class="select-text" data-select-all-scope><p>SIDE CONTENT</p></section>
<textarea id="editor">EDITOR DRAFT</textarea>
<iframe id="preview" srcdoc="<p id='preview-text'>HTML PREVIEW</p>"></iframe>
<section id="shadow-scope" class="select-text" data-select-all-scope>
  <div id="shadow-host"></div>
</section>
<div id="root"></div>
<script src="/fixture.js"></script>`);
      return;
    }
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(script.contents);
      return;
    }
    if (request.url === "/fixture.css") {
      response.writeHead(200, { "content-type": "text/css" });
      response.end(stylesheet.contents);
      return;
    }
    if (request.url === "/result" || request.url === "/error") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (request.url === "/result") {
          resolveResult(JSON.parse(body) as BrowserSelectionResults);
        } else {
          rejectResult(new Error(body));
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected browser fixture server to listen on a TCP port");
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    BB_SELECT_ALL_FIXTURE_URL: `http://127.0.0.1:${address.port}`,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronBinary,
    ["--headless", "--no-sandbox", mainPath],
    { env: childEnv },
  );
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    const results = await waitForBrowserResult({
      child,
      result: resultPromise,
      stderr,
      stdout,
    });
    expect(results).toEqual({
      chrome: "",
      editorPrevented: false,
      iframePrevented: false,
      main: "MAIN FIRST\n\nMAIN LAST",
      mainPrevented: true,
      shadow: "SHADOW FIRSTSHADOW LAST",
      shadowPrevented: true,
    });
  } finally {
    await stopElectron(child);
    await new Promise<void>((resolvePromise) =>
      server.close(() => resolvePromise()),
    );
    await rm(scratchRoot, { force: true, recursive: true });
  }
}, 30_000);
