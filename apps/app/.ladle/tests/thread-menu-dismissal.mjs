const page = await browser.getPage("main");
await page.setViewport({ width: 1280, height: 900 });
if (
  !page.url().includes("thread--thread-actions-menu--outside-click-dismissal")
) {
  throw new Error(
    "Open the Outside click dismissal story in preview mode first",
  );
}
await page.waitForSelector('[aria-label="Outside composer"]');
await page.evaluate(() => document.fonts.ready.then(() => true));
const count = () =>
  page.$eval('[aria-label="Activations"]', (element) =>
    Number(element.textContent),
  );
const focus = () =>
  page.$eval(
    '[aria-label="Outside composer"]',
    (element) => element === document.activeElement,
  );
const button = '[aria-label="Outside thread"]';
const composer = '[aria-label="Outside composer"]';
const rows = [];
for (const surface of ["dropdown", "context"]) {
  const open = async () => {
    if (surface === "dropdown")
      await page.click('[aria-label="Open thread menu"]');
    else
      await page.click('[aria-label="Thread context target"]', {
        button: "right",
      });
    await page.waitForSelector('[role="menu"]');
  };
  await open();
  const before = await count();
  await page.click(button);
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  if ((await count()) !== before)
    throw new Error(`${surface}: dismissal activated the outside thread`);
  await page.click(button);
  if ((await count()) !== before + 2)
    throw new Error(
      `${surface}: second click did not activate the outside thread`,
    );
  await open();
  await page.click(composer);
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  if (await focus())
    throw new Error(`${surface}: dismissal focused the outside composer`);
  await page.click(composer);
  if (!(await focus()))
    throw new Error(`${surface}: second click did not focus the composer`);
  await open();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  await open();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement === document.querySelector('[role="menu"] [role="menuitem"]'));
  for (let index = 0; index < 30; index++) {
    if (
      await page.evaluate(
        () => document.activeElement?.textContent?.trim() === "Fixture action",
      )
    )
      break;
    const previous = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((previous) => document.activeElement?.textContent !== previous, {}, previous);
  }
  if (
    !(await page.evaluate(
      () => document.activeElement?.textContent?.trim() === "Fixture action",
    ))
  )
    throw new Error(
      `${surface}: keyboard navigation did not reach the menu action`,
    );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  if ((await count()) !== before + 3)
    throw new Error(`${surface}: keyboard menu activation failed`);
  rows.push({
    surface,
    outsideClick: "dismiss-only",
    secondClick: "activates",
    keyboard: "passed",
  });
}
return rows;
