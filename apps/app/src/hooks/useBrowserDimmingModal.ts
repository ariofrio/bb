import { useEffect, useSyncExternalStore } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";

const browserDimmingModalCountAtom = atom(0);
const pluginDialogSelector =
  '[data-bb-plugin-root][data-bb-portaled-overlay][role="dialog"][data-state="open"]';
const pluginDialogListeners = new Set<() => void>();
let pluginDialogObserver: MutationObserver | null = null;

function subscribeToPluginDialogs(listener: () => void): () => void {
  pluginDialogListeners.add(listener);
  if (pluginDialogObserver === null && typeof document !== "undefined") {
    pluginDialogObserver = new MutationObserver(() => {
      for (const notify of pluginDialogListeners) notify();
    });
    pluginDialogObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-bb-plugin-root",
        "data-bb-portaled-overlay",
        "data-state",
        "role",
      ],
    });
  }
  return () => {
    pluginDialogListeners.delete(listener);
    if (pluginDialogListeners.size === 0) {
      pluginDialogObserver?.disconnect();
      pluginDialogObserver = null;
    }
  };
}

function isPluginDialogOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(pluginDialogSelector) !== null
  );
}

export function useBrowserDimmingOverlay(active: boolean): void {
  const setCount = useSetAtom(browserDimmingModalCountAtom);
  useEffect(() => {
    if (!active) {
      return;
    }
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [active, setCount]);
}

export function useBrowserDimmingModal(active: boolean): void {
  useBrowserDimmingOverlay(active);
}

export function useIsBrowserDimmingModalOpen(): boolean {
  const appDialogOpen = useAtomValue(browserDimmingModalCountAtom) > 0;
  const pluginDialogOpen = useSyncExternalStore(
    subscribeToPluginDialogs,
    isPluginDialogOpen,
    () => false,
  );
  return appDialogOpen || pluginDialogOpen;
}
