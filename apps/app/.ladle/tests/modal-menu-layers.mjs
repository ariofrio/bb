const page = await browser.getPage("main");
await page.setViewport({ width: 1280, height: 900 });
if (!page.url().includes("ui--modal-menu-layers--nested-overlays")) {
  throw new Error("Open the Nested overlays story in preview mode first");
}
await page.waitForSelector('[aria-label="Outside input"]');
await page.evaluate(() => {
  const root = document.createElement("div");
  root.id = "root";
  const ladle = document.querySelector("#ladle-root");
  ladle.replaceWith(root);
  root.append(ladle);
});
const cdp = await page.createCDPSession();
const escape = async () => {
  for (const type of ["keyDown", "keyUp"])
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
};
const count = () =>
  page.$eval('[aria-label="Activations"]', (e) => Number(e.textContent));
const results = [];
try {
  await page.click('[aria-label="Open fixture dialog"]');
  await page.waitForSelector('[role="dialog"][aria-label="Fixture dialog"]');
  for (const target of ["Nested menu", "Nested picker"]) {
    await page.click(`[aria-label="${target}"]`);
    await page.waitForFunction(
      () =>
        !!document.querySelector(
          '[role="menu"], [aria-label="Nested picker content"]',
        ),
    );
    const before = await count();
    await page.click('[aria-label="Dialog action"]');
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="menu"], [aria-label="Nested picker content"]',
        ),
    );
    if ((await count()) !== before)
      throw new Error(
        `${target}: dismissing click activated the dialog action`,
      );
    if (!(await page.$('[role="dialog"][aria-label="Fixture dialog"]')))
      throw new Error(`${target}: dismissed the parent dialog`);
    await page.click('[aria-label="Dialog action"]');
    if ((await count()) !== before + 2)
      throw new Error(`${target}: second click failed`);
    results.push({
      target,
      outsideClick: "dismiss-only",
      parentDialog: "retained",
    });
  }
  await page.click('[aria-label="Nested picker"]');
  await page.waitForSelector('[aria-label="Picker input"]');
  await page.click('[aria-label="Picker input"]');
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[aria-label="Picker input"]'),
  );
  const before = await count();
  await page.click('[aria-label="Picker action"]');
  if ((await count()) !== before + 1)
    throw new Error("Nested picker action was blocked");
  await escape();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Nested picker content"]'),
  );
  await escape();
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="dialog"]') &&
      getComputedStyle(document.body).pointerEvents === "auto",
  );
  await page.click('[aria-label="Outside input"]');
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[aria-label="Outside input"]'),
  );
  return {
    results,
    nestedInput: "passed",
    nestedAction: "passed",
    restoredOutsideInput: "passed",
  };
} finally {
  await escape();
  await page.evaluate(() => {
    const root = document.querySelector("#root");
    if (root) root.replaceWith(...root.childNodes);
  });
}
