// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadsQueryKey } from "@/hooks/queries/query-keys";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { useSenderThreadMetadataById } from "./useSenderThreadMetadataById";

function renderMetadataHook(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return renderHook(() => useSenderThreadMetadataById(), { wrapper: Wrapper });
}

function flushCacheNotifications(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
}

afterEach(() => {
  cleanup();
});

describe("useSenderThreadMetadataById", () => {
  it("does not rebuild metadata when a query only becomes stale", async () => {
    const client = new QueryClient();
    client.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender" }),
    ]);
    renderMetadataHook(client);
    const scan = vi.spyOn(client, "getQueriesData");
    await act(async () => {
      await client.invalidateQueries({
        queryKey: threadsQueryKey(),
        refetchType: "none",
      });
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("coalesces a burst of data changes into one metadata scan", async () => {
    const client = new QueryClient();
    client.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender" }),
    ]);
    const { result } = renderMetadataHook(client);
    const scan = vi.spyOn(client, "getQueriesData");
    await act(async () => {
      for (let index = 0; index < 10; index += 1)
        client.setQueryData(threadsQueryKey(), [
          makeThreadListEntry({ id: "thr_sender", title: `Title ${index}` }),
        ]);
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    expect(result.current.get("thr_sender")?.title).toBe("Title 9");
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("keeps the same map reference when a cache event rebuilds equal metadata", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender", title: "Sender thread" }),
    ]);
    const { result } = renderMetadataHook(queryClient);
    const initial = result.current;
    expect(initial.get("thr_sender")?.title).toBe("Sender thread");
    expect(initial.get("thr_sender")?.projectId).toBe("proj_test");

    await act(async () => {
      queryClient.setQueryData(threadsQueryKey(), [
        makeThreadListEntry({ id: "thr_sender", title: "Sender thread" }),
      ]);
    });
    await flushCacheNotifications();

    expect(result.current).toBe(initial);
  });

  it("returns a new map when thread metadata actually changes", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender", title: null }),
    ]);
    const { result } = renderMetadataHook(queryClient);
    const initial = result.current;
    expect(initial.get("thr_sender")?.title).toBeNull();

    await act(async () => {
      queryClient.setQueryData(threadsQueryKey(), [
        makeThreadListEntry({ id: "thr_sender", title: "Titled later" }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.get("thr_sender")?.title).toBe("Titled later");
    });
    expect(result.current).not.toBe(initial);
  });

  it("keeps the same map reference across events on unrelated query keys", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadsQueryKey(), [
      makeThreadListEntry({ id: "thr_sender", title: "Sender thread" }),
    ]);
    const { result } = renderMetadataHook(queryClient);
    const initial = result.current;

    await act(async () => {
      queryClient.setQueryData(["environments", "env_1"], { id: "env_1" });
    });
    await flushCacheNotifications();

    expect(result.current).toBe(initial);
  });
});
