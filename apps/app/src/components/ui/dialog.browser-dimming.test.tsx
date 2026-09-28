// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";

function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

afterEach(cleanup);

it("an app Dialog dims the browser through the shared-ui env seam", async () => {
  const { rerender } = render(
    <>
      <Dialog open>
        <DialogContent>
          <DialogTitle>Seam check</DialogTitle>
        </DialogContent>
      </Dialog>
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );

  rerender(
    <>
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Seam check</DialogTitle>
        </DialogContent>
      </Dialog>
      <DimProbe />
    </>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("clear"),
  );
});

it("a plugin Dialog dims the browser while its portal is open", async () => {
  render(<DimProbe />);
  const pluginDialog = document.createElement("div");
  pluginDialog.setAttribute("data-bb-plugin-root", "");
  pluginDialog.setAttribute("data-bb-portaled-overlay", "");
  pluginDialog.setAttribute("role", "dialog");
  pluginDialog.setAttribute("data-state", "open");
  document.body.append(pluginDialog);

  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("dimmed"),
  );

  pluginDialog.setAttribute("data-state", "closed");
  await waitFor(() =>
    expect(screen.getByTestId("dim").textContent).toBe("clear"),
  );
  pluginDialog.remove();
});
