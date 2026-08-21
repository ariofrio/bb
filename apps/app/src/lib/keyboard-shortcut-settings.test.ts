import { describe, expect, it } from "vitest";
import {
  APP_COMMAND_IDS,
  type AppDefaultKeybindings,
  type AppKeybindings,
} from "@bb/domain";
import { getAppCommandMetadata } from "./app-command-metadata";
import {
  appShortcutFromInput,
  getAppShortcutAssignmentError,
  getCommandShortcut,
  resetCommandShortcutOverride,
  setCommandShortcutOverride,
} from "./keyboard-shortcut-settings";

const defaults: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: false,
    shortcut: {
      key: "n",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
  {
    command: "thread.new",
    desktopOnly: true,
    shortcut: {
      key: "n",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

describe("keyboard shortcut settings", () => {
  it("has settings metadata for every command", () => {
    expect(
      APP_COMMAND_IDS.map((command) => getAppCommandMetadata(command).command),
    ).toEqual(APP_COMMAND_IDS);
  });

  it("records primary modifiers and unshifted punctuation", () => {
    expect(
      appShortcutFromInput(
        {
          key: "{",
          code: "BracketLeft",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toEqual({
      key: "[",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    });
  });

  // Recording must agree with matching: macOS reports Option+M as "µ", so the
  // recorder has to store the physical key or the captured chord would never
  // fire again.
  it("records an alt chord by its physical key", () => {
    expect(
      appShortcutFromInput(
        {
          key: "µ",
          code: "KeyM",
          metaKey: false,
          ctrlKey: false,
          altKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toMatchObject({ key: "m", alt: true, mod: false, shift: false });
  });

  it("preserves explicit non-primary modifiers", () => {
    expect(
      appShortcutFromInput(
        {
          key: "K",
          code: "KeyK",
          metaKey: true,
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
        },
        "MacIntel",
      ),
    ).toMatchObject({ key: "k", mod: true, control: true, shift: true });
  });

  it("rejects unmodified typing keys except for question choices", () => {
    const plainKey = {
      key: "x",
      mod: false,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };
    expect(
      getAppShortcutAssignmentError("thread.new", plainKey),
    ).not.toBeNull();
    expect(
      getAppShortcutAssignmentError("question.select.1", plainKey),
    ).toBeNull();
    expect(
      getAppShortcutAssignmentError("thread.new", { ...plainKey, key: "F2" }),
    ).toBeNull();
  });

  it("reserves the unshifted Select All chord for platform selection", () => {
    const selectAll = {
      key: "a",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    };

    expect(getAppShortcutAssignmentError("thread.new", selectAll)).toBe(
      "Command/Ctrl+A is reserved for Select All.",
    );
    expect(
      getAppShortcutAssignmentError("thread.new", {
        ...selectAll,
        shift: true,
      }),
    ).toBeNull();
    expect(
      getAppShortcutAssignmentError("thread.new", { ...selectAll, alt: true }),
    ).toBeNull();
    expect(
      getCommandShortcut(
        defaults,
        [{ command: "thread.new", shortcut: selectAll }],
        "thread.new",
        false,
        "Win32",
      ),
    ).toEqual(defaults[0]!.shortcut);
  });

  it("reserves the physical Select All key on a non-Latin layout", () => {
    const recorded = appShortcutFromInput(
      {
        key: "ф",
        code: "KeyA",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      "MacIntel",
    );

    expect(recorded).toMatchObject({ key: "a", mod: true });
    expect(
      recorded && getAppShortcutAssignmentError("thread.new", recorded),
    ).toBe("Command/Ctrl+A is reserved for Select All.");
  });

  it("stores disable overrides and removes redundant default overrides", () => {
    const disabled = setCommandShortcutOverride(
      defaults,
      [],
      "thread.new",
      null,
      false,
      "Win32",
    );
    expect(disabled).toEqual([{ command: "thread.new", shortcut: null }]);
    expect(
      getCommandShortcut(defaults, disabled, "thread.new", false, "Win32"),
    ).toBeNull();

    expect(
      setCommandShortcutOverride(
        defaults,
        disabled,
        "thread.new",
        defaults[0]!.shortcut,
        false,
        "Win32",
      ),
    ).toEqual([]);
  });

  it("assigns and resets a command without a default shortcut", () => {
    const unassignedDefaults: AppDefaultKeybindings = [
      {
        command: "thread.rename",
        desktopOnly: false,
        shortcut: null,
        when: { all: ["mainSurface"], none: ["modalOpen"] },
      },
    ];
    const shortcut = defaults[0]!.shortcut;
    const assigned = setCommandShortcutOverride(
      unassignedDefaults,
      [],
      "thread.rename",
      shortcut,
      false,
      "Win32",
    );

    expect(assigned).toEqual([{ command: "thread.rename", shortcut }]);
    expect(
      getCommandShortcut(
        unassignedDefaults,
        assigned,
        "thread.rename",
        false,
        "Win32",
      ),
    ).toEqual(shortcut);
    expect(resetCommandShortcutOverride(assigned, "thread.rename")).toEqual([]);
  });

  it("selects the active default for the current app surface", () => {
    expect(
      getCommandShortcut(defaults, [], "thread.new", false, "Win32"),
    ).toEqual(defaults[0]!.shortcut);
    expect(
      getCommandShortcut(defaults, [], "thread.new", true, "Win32"),
    ).toEqual(defaults[1]!.shortcut);
    expect(
      getCommandShortcut(
        [defaults[1]!],
        [{ command: "thread.new", shortcut: defaults[1]!.shortcut }],
        "thread.new",
        false,
        "Win32",
      ),
    ).toBeNull();
  });

  it("selects the platform-specific web default", () => {
    const platformDefaults: AppKeybindings = [
      {
        ...defaults[0]!,
        shortcut: { ...defaults[0]!.shortcut, control: true, mod: false },
        when: {
          all: ["mainSurface", "webSurface", "macPlatform"],
          none: ["modalOpen"],
        },
      },
      {
        ...defaults[0]!,
        shortcut: { ...defaults[0]!.shortcut, shift: true },
        when: {
          all: ["mainSurface", "webSurface"],
          none: ["modalOpen", "macPlatform"],
        },
      },
      defaults[1]!,
    ];

    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", false, "MacIntel"),
    ).toEqual(platformDefaults[0]!.shortcut);
    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", false, "Win32"),
    ).toEqual(platformDefaults[1]!.shortcut);
    expect(
      getCommandShortcut(platformDefaults, [], "thread.new", true, "MacIntel"),
    ).toEqual(platformDefaults[2]!.shortcut);
  });
});
