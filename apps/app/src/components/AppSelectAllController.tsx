import { useEffect } from "react";
import { isMacKeyboardPlatform, isSelectAllShortcutInput } from "@bb/domain";
import {
  clearSelectAllHighlight,
  closestEventElement,
  ensureShadowSelectionPolicy,
  findSelectAllScopes,
  getSelectAllCopyText,
  isEditableTarget,
  resolveSelectAllRoot,
  selectAllScopeContents,
} from "@/lib/select-all-scope";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

function getDeepActiveElement(): Element | null {
  let activeElement: Element | null = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

function selectEditorContents(editor: Element): void {
  if (
    editor instanceof HTMLInputElement ||
    editor instanceof HTMLTextAreaElement
  ) {
    editor.select();
    return;
  }
  document.execCommand("selectAll");
}

export function AppSelectAllController() {
  useEffect(() => {
    interface CopyOverride {
      anchorNode: Node | null;
      anchorOffset: number;
      focusNode: Node | null;
      focusOffset: number;
      selectionText: string;
      text: string;
    }

    let activeScopes: WeakRef<HTMLElement>[] = [];
    let activeSelectionAnchors: WeakRef<Element>[] = [];
    let copyOverride: CopyOverride | null = null;

    function selectionMatchesCopyOverride(override: CopyOverride): boolean {
      const selection = window.getSelection();
      return (
        selection !== null &&
        selection.anchorNode === override.anchorNode &&
        selection.anchorOffset === override.anchorOffset &&
        selection.focusNode === override.focusNode &&
        selection.focusOffset === override.focusOffset &&
        selection.toString() === override.selectionText
      );
    }

    function captureCopyOverride(text: string | null): void {
      const selection = window.getSelection();
      copyOverride =
        text !== null && selection !== null
          ? {
              anchorNode: selection.anchorNode,
              anchorOffset: selection.anchorOffset,
              focusNode: selection.focusNode,
              focusOffset: selection.focusOffset,
              selectionText: selection.toString(),
              text,
            }
          : null;
    }

    function selectActiveScopeOrEditor(): boolean {
      copyOverride = null;
      clearSelectAllHighlight();
      const activeElement = getDeepActiveElement();
      if (activeElement instanceof HTMLIFrameElement) {
        return false;
      }
      if (activeElement !== null && isEditableTarget(activeElement)) {
        selectEditorContents(activeElement);
        return true;
      }
      const activeScope =
        activeScopes
          .map((scope) => scope.deref())
          .find((scope) => scope?.isConnected) ?? null;
      const activeSelectionAnchor =
        activeSelectionAnchors
          .map((anchor) => anchor.deref())
          .find((anchor) => anchor?.isConnected) ?? null;
      if (activeScope !== null && activeSelectionAnchor !== null) {
        const preferredRoot = activeSelectionAnchor.getRootNode();
        if (
          !(preferredRoot instanceof Document) &&
          !(preferredRoot instanceof ShadowRoot)
        ) {
          window.getSelection()?.removeAllRanges();
          return true;
        }
        const selectionRoot = resolveSelectAllRoot(activeScope, preferredRoot);
        const selectedScope = selectAllScopeContents(
          activeScope,
          selectionRoot,
          activeSelectionAnchor,
        );
        const registeredCopyText = getSelectAllCopyText(activeScope);
        captureCopyOverride(
          selectedScope === null
            ? null
            : (registeredCopyText ?? selectedScope.fallbackCopyText),
        );
        if (selectedScope === null) {
          window.getSelection()?.removeAllRanges();
        }
        return true;
      }
      window.getSelection()?.removeAllRanges();
      return true;
    }

    function handleCopy(event: ClipboardEvent) {
      const override = copyOverride;
      if (
        override === null ||
        !selectionMatchesCopyOverride(override) ||
        event.clipboardData === null
      ) {
        return;
      }
      event.clipboardData.setData("text/plain", override.text);
      event.preventDefault();
    }

    function handleSelectAll(event: KeyboardEvent) {
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (
        event.defaultPrevented ||
        !isSelectAllShortcutInput(
          event,
          isMacKeyboardPlatform(window.navigator.platform),
        ) ||
        isEditableTarget(target)
      ) {
        return;
      }

      event.preventDefault();
      if (event.repeat) return;
      selectActiveScopeOrEditor();
    }

    let preserveCopyOverrideThroughFocus = false;
    let preserveCopyOverrideTimer: number | null = null;

    function updateActiveScope(event: Event) {
      const isContextMenuPointerDown =
        event.type === "pointerdown" &&
        "button" in event &&
        typeof event.button === "number" &&
        (event.button === 2 ||
          (event.button === 0 &&
            "ctrlKey" in event &&
            event.ctrlKey === true &&
            isMacKeyboardPlatform(window.navigator.platform)));
      if (isContextMenuPointerDown) {
        preserveCopyOverrideThroughFocus = true;
        if (preserveCopyOverrideTimer !== null) {
          window.clearTimeout(preserveCopyOverrideTimer);
        }
        preserveCopyOverrideTimer = window.setTimeout(() => {
          preserveCopyOverrideThroughFocus = false;
          preserveCopyOverrideTimer = null;
        }, 0);
      } else if (event.type === "focusin" && preserveCopyOverrideThroughFocus) {
        preserveCopyOverrideThroughFocus = false;
        if (preserveCopyOverrideTimer !== null) {
          window.clearTimeout(preserveCopyOverrideTimer);
          preserveCopyOverrideTimer = null;
        }
        return;
      } else {
        preserveCopyOverrideThroughFocus = false;
        if (preserveCopyOverrideTimer !== null) {
          window.clearTimeout(preserveCopyOverrideTimer);
          preserveCopyOverrideTimer = null;
        }
        copyOverride = null;
        clearSelectAllHighlight();
      }
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (target === null || isEditableTarget(target)) {
        activeScopes = [];
        activeSelectionAnchors = [];
        return;
      }
      const composedPath = event.composedPath();
      const scopes = findSelectAllScopes(composedPath);
      if (event.type === "pointerdown" && scopes.length > 0) {
        const selectionRoot = target.getRootNode();
        if (selectionRoot instanceof ShadowRoot) {
          ensureShadowSelectionPolicy(selectionRoot);
        }
      }
      activeScopes = scopes.map((scope) => new WeakRef(scope));
      activeSelectionAnchors = composedPath
        .filter(
          (candidate): candidate is Element => candidate instanceof Element,
        )
        .map((anchor) => new WeakRef(anchor));
    }

    window.addEventListener("pointerdown", updateActiveScope, true);
    window.addEventListener("focusin", updateActiveScope, true);
    // Select All is a platform-reserved chord. Capture prevents descendant
    // controls that stop keydown propagation from falling back to document-wide
    // native selection; editable targets still return to native handling above.
    window.addEventListener("keydown", handleSelectAll, true);
    document.addEventListener("copy", handleCopy, true);
    const unsubscribeDesktopSelectAll = getBbDesktopInfo()?.onSelectAll?.(
      selectActiveScopeOrEditor,
    );
    return () => {
      window.removeEventListener("pointerdown", updateActiveScope, true);
      window.removeEventListener("focusin", updateActiveScope, true);
      window.removeEventListener("keydown", handleSelectAll, true);
      document.removeEventListener("copy", handleCopy, true);
      unsubscribeDesktopSelectAll?.();
      if (preserveCopyOverrideTimer !== null) {
        window.clearTimeout(preserveCopyOverrideTimer);
      }
      clearSelectAllHighlight();
    };
  }, []);

  return null;
}
