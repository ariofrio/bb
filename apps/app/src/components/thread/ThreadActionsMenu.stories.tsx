import { useState, type ReactNode } from "react";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import type { ThreadListEntry } from "@bb/domain";
import {
  experimental_THREAD_ACTION_GROUPS,
  type PluginThreadActionsInlineItem,
} from "@get-bb/plugin-sdk";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import { ThreadActionsProvider } from "./ThreadActionsProvider";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";

export default {
  title: "thread/Thread actions menu",
};

function Stage({ children }: { children: ReactNode }) {
  return (
    <ThreadActionsProvider>
      <div className="flex w-fit items-center rounded-md bg-sidebar p-2 text-sidebar-foreground">
        {children}
      </div>
    </ThreadActionsProvider>
  );
}

function Menu({ thread }: { thread: ThreadListEntry }) {
  return (
    <ThreadActionsMenu
      thread={threadListEntryActionTarget(thread)}
      trigger={(props) => (
        <button {...props} type="button" aria-label="Thread actions">
          ...
        </button>
      )}
    />
  );
}

export function Overview() {
  const readThread = makeThreadListEntry({
    id: "thr_read",
    lastReadAt: 200,
    latestAttentionAt: 100,
  });
  const unreadPinnedThread = makeThreadListEntry({
    id: "thr_unread",
    lastReadAt: 100,
    latestAttentionAt: 200,
    pinnedAt: 150,
  });
  const archivedThread = makeThreadListEntry({
    id: "thr_archived",
    archivedAt: 150,
  });

  return (
    <StoryCard>
      <StoryRow
        label="read · unpinned"
        hint="Mark unread · Pin — Rename — Archive · Delete"
      >
        <Stage>
          <Menu thread={readThread} />
        </Stage>
      </StoryRow>
      <StoryRow
        label="unread · pinned"
        hint="read toggle flips to Mark read; Pin flips to Unpin"
      >
        <Stage>
          <Menu thread={unreadPinnedThread} />
        </Stage>
      </StoryRow>
      <StoryRow label="archived" hint="Archive flips to Unarchive">
        <Stage>
          <Menu thread={archivedThread} />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}

export function OutsideClickDismissal() {
  const [activations, setActivations] = useState(0);
  const thread = threadListEntryActionTarget(
    makeThreadListEntry({ id: "thr_menu" }),
  );
  const inline: PluginThreadActionsInlineItem[] = [
    {
      key: "fixture",
      group: experimental_THREAD_ACTION_GROUPS.organize,
      action: {
        label: "Fixture action",
        icon: "Pin",
        run: () => setActivations((count) => count + 1),
      },
    },
  ];
  return (
    <ThreadActionsProvider>
      <div className="flex flex-col items-start gap-8 p-8">
        <ThreadActionsMenu
          thread={thread}
          inline={inline}
          trigger={(props) => (
            <button {...props} type="button" aria-label="Open thread menu">
              Open thread menu
            </button>
          )}
        />
        <ThreadActionsContextMenu thread={thread} inline={inline}>
          <button type="button" aria-label="Thread context target">
            Thread context target
          </button>
        </ThreadActionsContextMenu>
        <div className="absolute right-8 top-8 flex flex-col gap-8">
          <button
            type="button"
            aria-label="Outside thread"
            onPointerDown={() => setActivations((count) => count + 1)}
            onClick={() => setActivations((count) => count + 1)}
          >
            Outside thread
          </button>
          <textarea aria-label="Outside composer" />
          <output aria-label="Activations">{activations}</output>
        </div>
      </div>
    </ThreadActionsProvider>
  );
}
