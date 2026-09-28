import {
  createServerAccessRecheck,
  registerServerAccess,
} from "./server-access.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerConnectCli } from "./cli.js";
import { createKvCredentialStore } from "./credential.js";
import {
  connectRpcContract,
  createRpcHandlers,
  type MobilePairingGate,
} from "./rpc.js";
import { ShareRegistry } from "./shares.js";
import { ConnectTunnel } from "./tunnel.js";
import { ShareHostResolver } from "./hosts.js";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";
import { resolveDefaultConnectBaseUrl } from "./redeem.js";
import {
  CONNECT_REALTIME_CHANNEL,
  REMOTE_ACTIVITY_INSTRUCTIONS_MS,
} from "./types.js";
import { createDeviceCodeIssuer } from "./sealed/device-codes.js";
import { createKvDeviceRegistry } from "./sealed/devices.js";
import { createKvServerIdentityStore } from "./sealed/identity.js";
import { registerSealedRoutes } from "./sealed/route.js";
import { SealedAccess } from "./sealed/sealed-access.js";
import {
  SEALED_HTTP_PREFIX,
  SEALED_INFO_ROUTE_PATH,
  SEALED_REALTIME_CHANNEL,
} from "./sealed/types.js";

const ALIAS_PROBE_TIMEOUT_MS = 1_500;

async function portServesThisBb(
  port: number,
  info: () => Promise<{ publicKey: string }>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}${SEALED_HTTP_PREFIX}${SEALED_INFO_ROUTE_PATH}`,
      { signal: AbortSignal.timeout(ALIAS_PROBE_TIMEOUT_MS) },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { publicKey?: unknown };
    return (
      typeof body.publicKey === "string" &&
      body.publicKey === (await info()).publicKey
    );
  } catch {
    return false;
  }
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    sendRemoteInstructions: {
      type: "boolean",
      label: "Tell agents about remote access",
      description:
        "When you use BB remotely, tell agents to share servers through Connect. Applies to new agent sessions.",
      default: true,
    },
  });
  let currentSettings = await settings.get();
  settings.onChange((next) => {
    currentSettings = next;
  });
  const store = createKvCredentialStore(bb.storage.kv);
  let tunnel!: ConnectTunnel;
  let sealed!: SealedAccess;
  const hostResolver = new ShareHostResolver(() => bb.sdk);
  const getLoopbackBaseUrl = () =>
    resolveLocalCloudLoopbackUrl(
      tunnel.getCredential()?.serverUrl,
      process.env.BB_DEV_APP_PORT,
    ) ?? bb.server.loopbackBaseUrl;

  const shares = new ShareRegistry({
    kv: bb.storage.kv,
    hosts: bb.hosts,
    hostResolver,
    getLoopbackBaseUrl,
    getCredential: () => tunnel.getCredential(),
    servesThisBb: (port) => portServesThisBb(port, () => sealed.info()),
    log: bb.log,
    onChange: () => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, tunnel.status());
    },
  });

  bb.events.on("experimental_host.deleted", async ({ host }) => {
    await shares.pruneHost(host.id);
  });

  const recheckServerAccess = createServerAccessRecheck(bb);
  tunnel = new ConnectTunnel({
    store,
    shares,
    defaultBaseUrl: resolveDefaultConnectBaseUrl(process.env),
    getLoopbackBaseUrl,
    log: bb.log,
    onStatusChange: (status) => {
      bb.realtime.publish(CONNECT_REALTIME_CHANNEL, status);
      recheckServerAccess(status);
    },
    guardStream: (stream) => sealed.guardStream(stream),
    sealedRemoteClients: () => sealed.remoteClients,
    onPaired: async () => {
      if (await sealed.requireForNewPairing()) {
        bb.log.info(
          "sealed connections are required for this new pairing; approve devices with `bb connect approve-device` or a device code",
        );
      }
    },
  });

  let publishSealed = Promise.resolve();
  sealed = new SealedAccess({
    identity: createKvServerIdentityStore(bb.storage.kv),
    devices: createKvDeviceRegistry(bb.storage.kv),
    codes: createDeviceCodeIssuer(),
    policy: bb.storage.kv,
    log: bb.log,
    onChange: () => {
      publishSealed = publishSealed
        .then(() => sealed.status())
        .then((status) => {
          bb.realtime.publish(SEALED_REALTIME_CHANNEL, status);
        })
        .catch((error: unknown) => {
          bb.log.warn(
            `failed to publish sealed status: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      tunnel.republish();
    },
    onRequired: () => {
      const closed = tunnel.reguard();
      if (closed > 0) {
        bb.log.info(
          `closed ${closed} readable Connect stream${closed === 1 ? "" : "s"} because encryption is now required`,
        );
      }
    },
  });

  await sealed.load();

  registerSealedRoutes({
    bb,
    access: sealed,
    createMachineCode: () => tunnel.createMachineCode(),
    getLoopbackBaseUrl,
    getPublicOrigin: () => {
      const url = tunnel.getCredential()?.serverUrl;
      return url === undefined ? null : new URL(url).origin;
    },
    log: bb.log,
    onActivity: (at) => tunnel.noteRemoteActivity(at),
    onRemoteClientsChange: () => tunnel.republish(),
  });

  await registerServerAccess(bb, tunnel);

  const mobilePairing: MobilePairingGate = {
    enabled: async () => (await bb.sdk.system.config()).experiments.mobileApp,
  };

  bb.rpc.register(
    connectRpcContract,
    createRpcHandlers(tunnel, hostResolver, mobilePairing, sealed),
  );
  registerConnectCli({ bb, tunnel, hostResolver, mobilePairing, sealed });

  bb.agents.contributeInstructions(() => {
    if (!currentSettings.sendRemoteInstructions) return null;
    const status = tunnel.status();
    if (!status.paired || status.url === null) return null;
    const recent =
      status.remoteClients > 0 ||
      (status.lastRemoteActivityAt !== null &&
        Date.now() - status.lastRemoteActivityAt <
          REMOTE_ACTIVITY_INSTRUCTIONS_MS);
    if (!recent) return null;
    return (
      `The user is currently viewing this bb remotely at ${status.url}. ` +
      "Port shares work from a thread on any enrolled host: when you start an HTTP server they should see, run `bb connect expose <port>` from that thread. " +
      "The command returns the correct public URL for the thread's host; give it to them as a markdown link because a localhost URL will not work remotely."
    );
  });

  if (tunnel.getCredential() !== null && !sealed.hasPolicy) {
    bb.status.needsConfiguration(
      "This bb was paired before sealed connections existed. Decide whether to require them: Settings → Remote access, or `bb connect require-encryption on|off`. Until then the relay can still read API traffic.",
    );
  }

  bb.background.service("tunnel", {
    async start(signal) {
      await tunnel.start();
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      tunnel.stop();
      sealed.disconnectAll();
    },
  });
}
