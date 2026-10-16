// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import type { PromptBoxHandle } from "./PromptBoxInternal";
import { usePromptVoice } from "./usePromptVoice";
import type { PromptDraftState } from "@bb/client-core";

vi.mock("@/lib/api", () => ({
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: vi.fn(),
}));

const voiceInput = {
  state: "transcribing" as const,
  microphoneWarning: null,
  isSupported: true,
  unsupportedReason: null,
  stream: null,
  delivery: "insert" as const,
  failedRecordings: [],
  start: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePromptVoice", () => {
  it("keeps transcription separate from the live completion transition", async () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });

    let finishTransition: (() => void) | undefined;
    const playVoiceCompletionTransition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
        }),
    );
    const insertTextAtCursor = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript: vi.fn(),
        playVoiceCompletionTransition,
      } satisfies PromptBoxHandle,
    };

    renderHook(() => usePromptVoice(promptBoxRef, undefined, null));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    const transcription = options?.onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
    });

    await expect(transcription).resolves.toBe("Transcript");
    expect(playVoiceCompletionTransition).not.toHaveBeenCalled();
    const transition = options?.playCompletionTransition?.();
    expect(playVoiceCompletionTransition).toHaveBeenCalledOnce();

    let settled = false;
    void transition?.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishTransition?.();
    await expect(transition).resolves.toBeUndefined();
    expect(insertTextAtCursor).not.toHaveBeenCalled();
  });

  it("keeps send and add-to-draft transcript delivery independent", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      state: "recording",
      isRecording: true,
      isProcessing: false,
      isListening: true,
    });
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
      } satisfies PromptBoxHandle,
    };
    const { result } = renderHook(() =>
      usePromptVoice(promptBoxRef, undefined, null),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => {
      result.current.send();
    });
    expect(voiceInput.stop).toHaveBeenCalledExactlyOnceWith("send");
    act(() => options?.onTranscript("first transcript", "send"));
    expect(sendVoiceTranscript).toHaveBeenCalledExactlyOnceWith(
      "first transcript",
    );
    act(() => {
      result.current.cancel();
    });
    expect(voiceInput.cancel).toHaveBeenCalledOnce();
    act(() => {
      result.current.stop();
      options?.onTranscript("draft transcript", "insert");
    });
    expect(voiceInput.stop).toHaveBeenLastCalledWith("insert");
    expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
      "draft transcript",
    );
    expect(sendVoiceTranscript).toHaveBeenCalledOnce();
  });

  it("does not carry send intent into another recording after transcription fails", () => {
    let state: "recording" | "error" = "recording";
    vi.mocked(useVoiceInput).mockImplementation(() => ({
      ...voiceInput,
      state,
      isRecording: state === "recording",
      isProcessing: false,
      isListening: state === "recording",
    }));
    const insertTextAtCursor = vi.fn();
    const sendVoiceTranscript = vi.fn();
    const promptBoxRef = {
      current: {
        captureHeightForLayoutChange: vi.fn(),
        focusEnd: vi.fn(),
        getTextBeforeCursor: vi.fn(),
        insertTextAtCursor,
        sendVoiceTranscript,
        playVoiceCompletionTransition: vi.fn(),
      } satisfies PromptBoxHandle,
    };
    const { result, rerender } = renderHook(() =>
      usePromptVoice(promptBoxRef, undefined, null),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    act(() => result.current.send());
    state = "error";
    rerender();
    state = "recording";
    rerender();
    act(() => options?.onTranscript("later transcript", "insert"));
    expect(sendVoiceTranscript).not.toHaveBeenCalled();
    expect(insertTextAtCursor).toHaveBeenCalledExactlyOnceWith(
      "later transcript",
    );
  });

  it.each(["send", "stop"] as const)(
    "preserves %s intent for the originating draft after navigating away",
    async (action) => {
      vi.mocked(useVoiceInput).mockReturnValue({
        ...voiceInput,
        state: "recording",
        isRecording: true,
        isProcessing: false,
        isListening: true,
      });
      const sendVoiceTranscript = vi.fn();
      const promptBoxRef = {
        current: {
          captureHeightForLayoutChange: vi.fn(),
          focusEnd: vi.fn(),
          getTextBeforeCursor: vi.fn(),
          insertTextAtCursor: vi.fn(),
          sendVoiceTranscript,
          playVoiceCompletionTransition: vi.fn(),
        } satisfies PromptBoxHandle,
      };
      let draft: PromptDraftState = {
        text: "Existing",
        mentions: [],
        attachments: [],
      };
      const submit = vi.fn(async () => {
        expect(draft.text).toBe("Existing and later edits late transcript");
      });
      const origin = {
        getCurrent: () => draft,
        setDraft: (next: PromptDraftState) => {
          draft = next;
        },
        submit,
      };
      const { result, unmount } = renderHook(() =>
        usePromptVoice(promptBoxRef, origin, null),
      );
      const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
      act(() => result.current[action]());
      unmount();
      draft = { ...draft, text: "Existing and later edits" };
      await options?.onTranscript(
        "late transcript",
        action === "send" ? "send" : "insert",
      );
      expect(draft.text).toBe("Existing and later edits late transcript");
      expect(sendVoiceTranscript).not.toHaveBeenCalled();
      expect(promptBoxRef.current.insertTextAtCursor).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledTimes(action === "send" ? 1 : 0);
    },
  );

  it("appends a completed transcript to the originating draft after unmount", () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      isRecording: false,
      isProcessing: true,
      isListening: false,
    });
    const promptBoxRef = { current: null };
    let draft: PromptDraftState = {
      text: "Existing",
      mentions: [],
      attachments: [],
    };
    const getCurrent = vi.fn(() => draft);
    const setDraft = vi.fn((next: PromptDraftState) => {
      draft = next;
    });
    renderHook(() =>
      usePromptVoice(promptBoxRef, { getCurrent, setDraft }, null),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    draft = { ...draft, text: "Existing and later edits" };
    options?.onTranscript("new words", "insert");
    expect(draft).toEqual({
      text: "Existing and later edits new words",
      mentions: [],
      attachments: [],
    });
  });
});
