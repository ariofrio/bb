const page = await browser.getPage("main");
await page.setViewport({ width: 393, height: 852 });
if (!page.url().includes("ui--modal-menu-layers--app-layers")) {
  throw new Error("Open the App layers story in preview mode first");
}
await page.waitForSelector('[data-testid="secondary-panel-shelf"]', {
  timeout: 30_000,
});
await page.evaluate(() => {
  const root = document.createElement("div");
  root.id = "root";
  const ladle = document.querySelector("#ladle-root");
  ladle.replaceWith(root);
  root.append(ladle);
});
try {
  await page.click('[aria-label="Show layer toast"]');
  await page.waitForSelector("[data-sonner-toast]", { timeout: 30_000 });
  await page.evaluate(async () => {
    const toast = document.querySelector("[data-sonner-toast]");
    await Promise.all(toast.getAnimations().map((a) => a.finished));
  });
  const toastVisible = await page.evaluate(() => {
    const toast = document.querySelector("[data-sonner-toast]");
    const r = toast.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2,
    );
    return !!hit?.closest("[data-sonner-toast]");
  });
  if (!toastVisible)
    throw new Error("App toast is covered by the compact shelf");
  await page.click('[aria-label="Open layer dialog"]');
  await page.waitForSelector('[aria-label="Layer fixture dialog"]');
  await page.click('[aria-label="Show update overlay"]');
  await page.waitForSelector("[data-app-update-overlay]");
  const updateVisible = await page.evaluate(() => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!hit?.closest("[data-app-update-overlay]");
  });
  if (!updateVisible)
    throw new Error("App update overlay is covered by the dialog");
  return { toastAboveShelf: true, updateAboveDialog: true };
} finally {
  await page.evaluate(() => {
    const root = document.querySelector("#root");
    if (root) root.replaceWith(...root.childNodes);
  });
}
