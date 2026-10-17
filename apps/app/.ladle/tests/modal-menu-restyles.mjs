const page = await browser.getPage("main");
await page.setViewport({ width: 1280, height: 900 });
if (
  !page.url().includes("thread--thread-actions-menu--outside-click-dismissal")
) {
  throw new Error(
    "Open the Outside click dismissal story in preview mode first",
  );
}
await page.waitForSelector('[aria-label="Outside composer"]', {
  timeout: 30_000,
});
await page.evaluate(() => document.fonts.ready.then(() => true));
const cdp = await page.createCDPSession();
const backgroundSize = 1200;
await page.evaluate(() => {
  if (document.querySelector("#root")) return;
  const ladle = document.querySelector("#ladle-root");
  if (!ladle) throw new Error("Missing app or story root");
  const root = document.createElement("div");
  root.id = "root";
  root.dataset.menuRestyleFixture = "";
  ladle.replaceWith(root);
  root.append(ladle);
});
await page.evaluate((size) => {
  const background = document.createElement("div");
  background.id = "menu-restyle-background";
  background.style =
    "position:fixed;top:400px;left:0;width:300px;height:100px;overflow:hidden;pointer-events:none";
  for (let index = 0; index < size; index++) {
    const child = document.createElement("span");
    child.textContent = "Background ";
    child.style.paddingRight = "var(--removed-body-scroll-bar-size)";
    background.append(child);
  }
  document.querySelector("#root").append(background);
  background.getBoundingClientRect();
}, backgroundSize);
const key = async (value, code, number, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: value,
      code,
      windowsVirtualKeyCode: number,
      modifiers,
    });
  }
};
const count = () =>
  page.$eval('[aria-label="Activations"]', (e) => Number(e.textContent));
const rows = [];
try {
  for (const surface of ["dropdown", "context"]) {
    const open = async () => {
      if (surface === "dropdown")
        await page.click('[aria-label="Open thread menu"]');
      else
        await page.click('[aria-label="Thread context target"]', {
          button: "right",
        });
      await page.waitForSelector('[role="menu"]');
      await page.evaluate(
        () =>
          document.querySelector('[role="menu"]').getBoundingClientRect().width,
      );
    };
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline",
      transferMode: "ReturnAsStream",
    });
    await open();
    const openState = await page.evaluate(() => ({
      bodyPointer: getComputedStyle(document.body).pointerEvents,
      rootPointer: getComputedStyle(document.querySelector("#root"))
        .pointerEvents,
    }));
    await key("Escape", "Escape", 27);
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="menu"]') &&
        getComputedStyle(document.body).pointerEvents === "auto",
    );
    await page.evaluate(
      () =>
        document
          .querySelector("#menu-restyle-background")
          .getBoundingClientRect().width,
    );
    const completion = new Promise((resolve) =>
      cdp.on("Tracing.tracingComplete", resolve),
    );
    await cdp.send("Tracing.end");
    const { stream } = await completion;
    let text = "";
    while (true) {
      const chunk = await cdp.send("IO.read", { handle: stream });
      text += chunk.data;
      if (chunk.eof) break;
    }
    await cdp.send("IO.close", { handle: stream });
    const updates = JSON.parse(text).traceEvents.filter(
      (event) => event.name === "UpdateLayoutTree" && event.ph === "X",
    );
    const maximumRestyledElements = Math.max(
      0,
      ...updates.map((event) => event.args?.elementCount ?? 0),
    );
    if (maximumRestyledElements >= backgroundSize / 2) {
      throw new Error(
        `${surface}: menu restyled ${maximumRestyledElements} elements with ${backgroundSize} background elements`,
      );
    }
    if (openState.bodyPointer !== "none" || openState.rootPointer !== "auto") {
      throw new Error(
        `${surface}: modal blocking leaked inherited pointer events into the app root`,
      );
    }
    await open();
    const before = await count();
    await page.click('[aria-label="Outside thread"]');
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    if ((await count()) !== before)
      throw new Error(`${surface}: first outside click activated its target`);
    await page.click('[aria-label="Outside thread"]');
    if ((await count()) !== before + 2)
      throw new Error(`${surface}: second outside click failed`);
    await open();
    await page.click('[aria-label="Outside composer"]');
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    if (
      await page.$eval(
        '[aria-label="Outside composer"]',
        (e) => e === document.activeElement,
      )
    ) {
      throw new Error(`${surface}: first outside click focused the composer`);
    }
    await page.click('[aria-label="Outside composer"]');
    await page.waitForFunction(
      () =>
        document.activeElement ===
        document.querySelector('[aria-label="Outside composer"]'),
    );
    await open();
    await key("Home", "Home", 36);
    await page.waitForFunction(
      () => !!document.activeElement?.closest('[role="menu"]'),
    );
    await key("Tab", "Tab", 9);
    if (
      !(await page.evaluate(
        () => !!document.activeElement?.closest('[role="menu"]'),
      ))
    ) {
      throw new Error(`${surface}: focus escaped the modal menu`);
    }
    await key("Escape", "Escape", 27);
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    rows.push({
      surface,
      maximumRestyledElements,
      outsideClick: "dismiss-only",
      keyboard: "passed",
    });
  }
  const compensation = await page.evaluate(() => {
    const previous = document.body.style.getPropertyValue(
      "--removed-body-scroll-bar-size",
    );
    const priority = document.body.style.getPropertyPriority(
      "--removed-body-scroll-bar-size",
    );
    const child = document.createElement("div");
    child.style.marginRight = "var(--removed-body-scroll-bar-size)";
    document.querySelector("#root").append(child);
    try {
      document.body.style.setProperty("--removed-body-scroll-bar-size", "0em");
      const zero = getComputedStyle(document.body)
        .getPropertyValue("--removed-body-scroll-bar-size")
        .trim();
      document.body.style.setProperty("--removed-body-scroll-bar-size", "17px");
      return { zero, nonzero: getComputedStyle(child).marginRight };
    } finally {
      if (previous)
        document.body.style.setProperty(
          "--removed-body-scroll-bar-size",
          previous,
          priority,
        );
      else document.body.style.removeProperty("--removed-body-scroll-bar-size");
      child.remove();
    }
  });
  if (compensation.zero !== "0px" || compensation.nonzero !== "17px") {
    throw new Error(
      "Typed scrollbar compensation or nonzero inheritance failed: " +
        JSON.stringify(compensation),
    );
  }
  return { rows, compensation };
} finally {
  await key("Escape", "Escape", 27);
  await page.evaluate(() => {
    document.querySelector("#menu-restyle-background")?.remove();
    const fixture = document.querySelector("[data-menu-restyle-fixture]");
    if (fixture) fixture.replaceWith(...fixture.childNodes);
  });
}
