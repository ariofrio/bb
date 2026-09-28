import {
  useDeferredValue,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const subscribe = () => () => {};
const clientSnapshot = () => false;
const serverSnapshot = () => true;

export function DeferredContent({
  children,
  afterPaint = false,
}: {
  children: ReactNode;
  afterPaint?: boolean;
}) {
  const isStaticRender = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (!afterPaint) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPainted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [afterPaint]);
  const ready = useDeferredValue(!afterPaint || painted, isStaticRender);
  return ready ? children : null;
}
