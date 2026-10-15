import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { transcribeVoiceInput } from "@/lib/api";
import type { PromptDraftState } from "@bb/client-core";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { VoiceDelivery } from "@/lib/voice-recording-store";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";

async function requestVoiceTranscription({
  file,
  promptContext,
  signal,
}: {
  file: File;
  promptContext?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcription = await transcribeVoiceInput(file, promptContext, signal);
  return transcription.text;
}

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
  draft:
    | {
        getCurrent: () => PromptDraftState;
        setDraft: (draft: PromptDraftState) => void;
        submit?: PluginComposerHost["submit"];
      }
    | undefined,
  recordingKey: string | null,
): PromptVoiceConfig {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onTranscript = useCallback(
    (text: string, delivery: VoiceDelivery) => {
      const send = delivery === "send";
      if (mountedRef.current && promptBoxRef.current) {
        if (send) {
          promptBoxRef.current.sendVoiceTranscript(text);
        } else {
          promptBoxRef.current.insertTextAtCursor(text);
        }
        return;
      }
      if (!draft) return;
      const current = draft.getCurrent();
      const separator =
        current.text.length > 0 && !/\s$/.test(current.text) ? " " : "";
      draft.setDraft({
        ...current,
        text: `${current.text}${separator}${text}`,
      });
      if (send) return draft.submit?.({ experimental_data: null }, undefined);
    },
    [draft, promptBoxRef],
  );

  const getPromptContext = useCallback(
    () => promptBoxRef.current?.getTextBeforeCursor(),
    [promptBoxRef],
  );

  const playCompletionTransition = useCallback(
    () => promptBoxRef.current?.playVoiceCompletionTransition(),
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    recordingKey,
    onTranscript,
    onTranscribe: requestVoiceTranscription,
    getPromptContext,
    playCompletionTransition,
  });

  const { stop: stopVoiceInput } = voiceInput;
  const stop = useCallback(() => stopVoiceInput("insert"), [stopVoiceInput]);
  const send = useCallback(() => stopVoiceInput("send"), [stopVoiceInput]);

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      delivery: voiceInput.delivery,
      microphoneWarning: voiceInput.microphoneWarning,
      isSupported: voiceInput.isSupported,
      stream: voiceInput.stream,
      failedRecordings: voiceInput.failedRecordings,
      start: voiceInput.start,
      stop,
      send,
      retry: voiceInput.retry,
      discard: voiceInput.discard,
      download: voiceInput.download,
      cancel: voiceInput.cancel,
    }),
    [
      voiceInput.state,
      voiceInput.delivery,
      voiceInput.microphoneWarning,
      voiceInput.isSupported,
      voiceInput.stream,
      voiceInput.failedRecordings,
      voiceInput.start,
      stop,
      send,
      voiceInput.retry,
      voiceInput.discard,
      voiceInput.download,
      voiceInput.cancel,
    ],
  );
}
