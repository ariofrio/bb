import { describe, expect, it } from "vitest";
import { createAppVersionService } from "../../src/services/system/app-version.js";
import { testLogger } from "../helpers/test-app.js";

const REPOSITORY = "ariofrio/bb";
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;

interface ReleaseFixture {
  draft?: boolean;
  tag: string;
  assets?: string[];
}

function release(fixture: ReleaseFixture) {
  const version = fixture.tag.replace(/^desktop-v/u, "");
  const assets = fixture.assets ?? [
    `bb-app-${version}.tgz`,
    `bb-app-${version}.tgz.sha256`,
  ];
  return {
    assets: assets.map((name) => ({
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${fixture.tag}/${name}`,
      name,
    })),
    draft: fixture.draft ?? false,
    tag_name: fixture.tag,
  };
}

function createRoutedFetch(
  routes: Record<string, () => Response>,
  calls: string[],
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`Unexpected fetch ${url}`);
    return route();
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status,
    });
}

const UPSTREAM_NPM_ROUTES = {
  "https://registry.npmjs.org/bb-app/latest": json({ version: "0.46.1" }),
  "https://registry.npmjs.org/bb-app/nightly": json({
    version: "0.47.0-nightly.1.1",
  }),
};

function createForkService(
  releases: ReleaseFixture[] | (() => Response),
  calls: string[],
  appVersion = "0.46.1-ariofrio.7",
) {
  return createAppVersionService({
    config: { appVersion, isDevelopment: false },
    fetchImpl: createRoutedFetch(
      {
        ...UPSTREAM_NPM_ROUTES,
        [RELEASES_URL]:
          typeof releases === "function"
            ? releases
            : json(releases.map(release)),
      },
      calls,
    ),
    installKind: "npm",
    logger: testLogger,
    releaseRepository: REPOSITORY,
    sourceCommit: null,
  });
}

describe("createAppVersionService for a fork release source", () => {
  it("never offers upstream's npm release to a fork build", async () => {
    const calls: string[] = [];
    const service = createForkService(
      [
        { tag: "desktop-v0.46.1-ariofrio.7" },
        { tag: "desktop-latest", assets: [] },
      ],
      calls,
    );

    const response = await service.getSystemVersion();

    expect(response.latestVersion).toBe("0.46.1-ariofrio.7");
    expect(response.updateAvailable).toBe(false);
    expect(calls).toEqual([RELEASES_URL]);
  });

  it("offers the newest fork release that ships a verified bb-app tarball", async () => {
    const calls: string[] = [];
    const service = createForkService(
      [
        { tag: "desktop-v0.46.2-ariofrio.10", draft: true },
        {
          tag: "desktop-v0.46.2-ariofrio.9",
          assets: ["bb-app-0.46.2-ariofrio.9.tgz"],
        },
        { tag: "desktop-v0.46.1-ariofrio.8" },
        { tag: "desktop-v0.46.1-ariofrio.7" },
      ],
      calls,
    );

    const response = await service.getSystemVersion();

    expect(response.latestVersion).toBe("0.46.1-ariofrio.8");
    expect(response.updateAvailable).toBe(true);
    expect(response.upgradeCommand).toBe(
      "npx https://github.com/ariofrio/bb/releases/download/desktop-v0.46.1-ariofrio.8/bb-app-0.46.1-ariofrio.8.tgz",
    );
    expect(calls.some((url) => url.includes("registry.npmjs.org"))).toBe(false);
  });

  it.each([
    [
      "a network error",
      () => {
        throw new Error("getaddrinfo EAI_AGAIN api.github.com");
      },
    ],
    ["a rate limit", json({ message: "API rate limit exceeded" }, 403)],
    ["an unexpected payload", json({ releases: [] })],
  ])("stays fork-only after %s", async (_label, route) => {
    const calls: string[] = [];
    const service = createForkService(route, calls);

    const response = await service.getSystemVersion();

    expect(response.latestVersion).toBeNull();
    expect(response.updateAvailable).toBe(false);
    expect(response.upgradeCommand).not.toContain("bb-app@");
    expect(calls).toEqual([RELEASES_URL]);
  });

  it("reports no release rather than falling back when the fork has none", async () => {
    const calls: string[] = [];
    const service = createForkService(
      [{ tag: "desktop-latest", assets: [] }],
      calls,
    );

    const response = await service.getSystemVersion();

    expect(response.latestVersion).toBeNull();
    expect(calls).toEqual([RELEASES_URL]);
  });
});
