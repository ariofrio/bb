import { z } from "zod";
import { defineRpcContract, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import {
  ConnectListError,
  type DesktopSession,
  type ListAccountServersResult,
} from "@bb/connect-client";
import { ConnectPairError } from "./redeem.js";
import type { ConnectTunnel } from "./tunnel.js";
import type { ConnectStatus, ShareListing } from "./types.js";
import { MachineCodeError, type MachineCode } from "./machine-code.js";
import type { ShareHostResolver } from "./hosts.js";
import { DEVICE_SURFACES } from "@bb/sealed-channel";
import { DEVICE_STATUSES } from "./sealed/devices.js";
import type { SealedAccess } from "./sealed/sealed-access.js";
import type { SealedDeviceSummary, SealedStatus } from "./sealed/types.js";

const pairInputSchema = z.object({
  code: z.string().min(1),
  server: z.string().url().optional(),
  baseUrl: z.string().url().optional(),
});

const portInputSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    hostId: z.string().min(1).optional(),
  })
  .strict();
const revokeMachineInputSchema = z.object({ machineId: z.string().min(1) });

const shareListingSchema: z.ZodType<ShareListing> = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    port: z.number().int(),
    createdAt: z.number(),
    url: z.string(),
    unavailableReason: z.string().optional(),
  })
  .strict();

const connectStatusSchema: z.ZodType<ConnectStatus> = z
  .object({
    state: z.enum(["disconnected", "pairing", "connected", "reconnecting"]),
    paired: z.boolean(),
    handle: z.string().nullable(),
    url: z.string().nullable(),
    dashboardUrl: z.string(),
    lastError: z.string().nullable(),
    nextRetryAt: z.number().nullable(),
    since: z.number(),
    remoteClients: z.number().int(),
    lastRemoteActivityAt: z.number().nullable(),
    shares: z.array(shareListingSchema),
  })
  .strict();

const listAccountServersResultSchema: z.ZodType<ListAccountServersResult> = z
  .object({
    servers: z.array(
      z
        .object({
          handle: z.string(),
          name: z.string(),
          live: z.boolean(),
          url: z.string(),
        })
        .strict(),
    ),
    selfHandle: z.string(),
  })
  .strict();

const desktopSessionSchema: z.ZodType<DesktopSession> = z
  .object({
    cookie: z
      .object({
        domain: z.string(),
        expiresAt: z.number().int(),
        name: z.string(),
        value: z.string(),
      })
      .strict(),
  })
  .strict();

const mobilePairingSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const machineCodeSchema: z.ZodType<MachineCode> = z
  .object({
    code: z.string(),
    expiresAt: z.number(),
    serverUrl: z.string(),
  })
  .strict();

const sealedDeviceSchema: z.ZodType<SealedDeviceSummary> = z
  .object({
    id: z.string(),
    name: z.string(),
    surface: z.enum(DEVICE_SURFACES),
    status: z.enum(DEVICE_STATUSES),
    fingerprint: z.string(),
    createdAt: z.number(),
    approvedAt: z.number().nullable(),
    revokedAt: z.number().nullable(),
    lastSeenAt: z.number().nullable(),
    connected: z.boolean(),
    parentId: z.string().nullable(),
    approvedVia: z
      .enum(["device-code", "manual", "delegation", "account-gate"])
      .nullable(),
  })
  .strict();

const sealedStatusSchema: z.ZodType<SealedStatus> = z
  .object({
    protocolVersion: z.number().int(),
    publicKey: z.string(),
    fingerprint: z.string(),
    identityCreatedAt: z.number(),
    required: z.boolean(),
    activeChannels: z.number().int(),
    devices: z.array(sealedDeviceSchema),
  })
  .strict();

export const connectRpcContract = defineRpcContract({
  pair: { input: pairInputSchema, output: connectStatusSchema },
  status: { input: z.null(), output: connectStatusSchema },
  disconnect: { input: z.null(), output: connectStatusSchema },
  expose: { input: portInputSchema, output: shareListingSchema },
  unexpose: {
    input: portInputSchema,
    output: z
      .object({
        removed: z.boolean(),
        hostId: z.string(),
        hostName: z.string(),
        port: z.number().int(),
      })
      .strict(),
  },
  listShares: { input: z.null(), output: z.array(shareListingSchema) },
  listAccountServers: {
    input: z.null(),
    output: listAccountServersResultSchema,
  },
  createDesktopSession: { input: z.null(), output: desktopSessionSchema },
  mobilePairing: { input: z.null(), output: mobilePairingSchema },
  createMachineCode: { input: z.null(), output: machineCodeSchema },
  revokeMachine: {
    input: revokeMachineInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  sealedStatus: { input: z.null(), output: sealedStatusSchema },
});

type ConnectRpcHandlers = PluginRpcHandlers<typeof connectRpcContract>;

async function rethrowErrorCode<T>(
  operation: () => Promise<T>,
  isCoded: (error: unknown) => error is { code: string },
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isCoded(error)) throw new Error(error.code);
    throw error;
  }
}

export interface MobilePairingGate {
  enabled(): Promise<boolean>;
}

export function createRpcHandlers(
  tunnel: ConnectTunnel,
  hostResolver: ShareHostResolver,
  mobilePairing: MobilePairingGate,
  sealed: SealedAccess,
): ConnectRpcHandlers {
  return {
    async sealedStatus() {
      return sealed.status();
    },
    async pair(args) {
      return rethrowErrorCode(
        () =>
          tunnel.pair({
            code: args.code,
            ...(args.server !== undefined ? { serverUrl: args.server } : {}),
            ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
          }),
        (error) => error instanceof ConnectPairError,
      );
    },
    async status() {
      return tunnel.refreshStatus();
    },
    async disconnect() {
      return tunnel.disconnect();
    },
    async expose(args) {
      const host =
        args.hostId === undefined
          ? await hostResolver.serverHost()
          : await hostResolver.byId(args.hostId);
      return tunnel.expose(args.port, host);
    },
    async unexpose(args) {
      return tunnel.unexpose(
        args.port,
        args.hostId ?? (await hostResolver.serverHostId()),
      );
    },
    async listShares() {
      return tunnel.listShares();
    },
    async listAccountServers() {
      return rethrowErrorCode(
        () => tunnel.listAccountServers(),
        (error) => error instanceof ConnectListError,
      );
    },
    async createDesktopSession() {
      return rethrowErrorCode(
        () => tunnel.createDesktopSession(),
        (error) => error instanceof ConnectListError,
      );
    },
    async mobilePairing() {
      return { enabled: await mobilePairing.enabled() };
    },
    async createMachineCode() {
      return rethrowErrorCode(
        () => tunnel.createMachineCode(),
        (error) => error instanceof MachineCodeError,
      );
    },
    async revokeMachine(args) {
      await tunnel.revokeMachine(args.machineId);
      return { ok: true };
    },
  };
}
