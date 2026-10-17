import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";

export default { title: "ui/Modal menu layers" };

export function NestedOverlays() {
  const [activations, setActivations] = useState(0);
  return (
    <div className="flex flex-col gap-4 p-8">
      <textarea aria-label="Outside input" />
      <output aria-label="Activations">{activations}</output>
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" aria-label="Open fixture dialog">
            Open fixture dialog
          </button>
        </DialogTrigger>
        <DialogContent aria-label="Fixture dialog">
          <DialogTitle>Fixture dialog</DialogTitle>
          <DialogDescription>
            Nested menu and picker regression fixture.
          </DialogDescription>
          <button
            type="button"
            aria-label="Dialog action"
            onPointerDown={() => setActivations((n) => n + 1)}
            onClick={() => setActivations((n) => n + 1)}
          >
            Dialog action
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Nested menu">
                Open nested menu
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setActivations((n) => n + 1)}>
                Nested menu action
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover modal>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Nested picker">
                Open nested picker
              </button>
            </PopoverTrigger>
            <PopoverContent aria-label="Nested picker content">
              <input aria-label="Picker input" />
              <button
                type="button"
                aria-label="Picker action"
                onClick={() => setActivations((n) => n + 1)}
              >
                Picker action
              </button>
            </PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>
    </div>
  );
}
