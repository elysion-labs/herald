import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { z } from 'zod';

import { browserViewport } from '../shared/browser-preview.ts';

const storageKey = 'herald-browser-window';
const ratio = browserViewport.width / browserViewport.height;
const minWidth = 264;
const snapDistance = 24;

const layoutSchema = z.object({
  mode: z
    .enum(['pip', 'capsule', 'expanded'])
    .transform(mode => (mode === 'expanded' ? 'pip' : mode)),
  width: z.number().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

type Layout = z.infer<typeof layoutSchema>;

export type BrowserWindowMode = Layout['mode'];

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type GestureKind = 'move' | ResizeCorner;
interface Size {
  width: number;
  height: number;
}
type Frame = Size & { x: number; y: number };

interface Gesture {
  kind: GestureKind;
  pointer: number;
  startX: number;
  startY: number;
  original: Frame;
  frame: Frame;
}

function loadLayout(): Layout {
  const initial: Layout = { mode: 'pip', width: 360, x: 1, y: 1 };

  try {
    const stored = layoutSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'));

    return stored.data ?? initial;
  } catch {
    return initial;
  }
}

function clamp(value: number, maximum: number) {
  return Math.round(Math.min(Math.max(0, maximum), Math.max(0, value)));
}

function frameFor(layout: Layout, area: Size): Frame {
  const limit = Math.min(area.width, Math.floor(area.height * ratio));

  if (layout.mode === 'capsule') {
    const width = Math.min(180, area.width);
    const height = Math.min(34, area.height);

    return {
      x: Math.round((area.width - width) * layout.x),
      y: Math.round((area.height - height) * layout.y),
      width,
      height,
    };
  }

  const width = clamp(layout.width, limit);
  const height = Math.round(width / ratio);

  return {
    x: Math.round((area.width - width) * layout.x),
    y: Math.round((area.height - height) * layout.y),
    width,
    height,
  };
}

function moveFrame(gesture: Gesture, dx: number, dy: number, area: Size): Frame {
  const { original, kind } = gesture;

  if (kind === 'move') {
    return {
      ...original,
      x: clamp(original.x + dx, area.width - original.width),
      y: clamp(original.y + dy, area.height - original.height),
    };
  }

  const left = kind.endsWith('w');
  const top = kind.startsWith('n');
  const fixedX = left ? original.x + original.width : original.x;
  const fixedY = top ? original.y + original.height : original.y;
  const horizontal = left ? -dx : dx;
  const vertical = (top ? -dy : dy) * ratio;
  const delta = Math.abs(horizontal) > Math.abs(vertical) ? horizontal : vertical;

  const maxWidth = Math.min(
    left ? fixedX : area.width - fixedX,
    Math.floor((top ? fixedY : area.height - fixedY) * ratio),
  );

  const width = clamp(Math.max(minWidth, original.width + delta), maxWidth);
  const height = Math.round(width / ratio);

  return { x: left ? fixedX - width : fixedX, y: top ? fixedY - height : fixedY, width, height };
}

function anchor(offset: number, travel: number, previous: number, snap: boolean) {
  if (travel <= 0) {
    return previous;
  }

  if (snap && Math.min(offset, travel - offset) <= snapDistance) {
    return offset < travel / 2 ? 0 : 1;
  }

  return offset / travel;
}

export function useBrowserWindow() {
  const areaRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const [layout, setLayout] = useState(loadLayout);
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const [preview, setPreview] = useState<Frame>();
  const frame = preview ?? frameFor(layout, area);

  useLayoutEffect(() => {
    const node = areaRef.current;

    if (!node) {
      return;
    }

    function measure() {
      if (node) {
        setArea({ width: node.clientWidth, height: node.clientHeight });
      }
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();

    return () => observer.disconnect();
  }, []);

  function save(next: Layout) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setLayout(next);
  }

  function begin(event: PointerEvent<HTMLElement>, kind: GestureKind) {
    if (event.button !== 0 || gesture.current) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      kind,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      original: frame,
      frame,
    };
    setPreview(frame);
  }

  function update(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;

    if (!active || active.pointer !== event.pointerId) {
      return;
    }

    active.frame = moveFrame(
      active,
      event.clientX - active.startX,
      event.clientY - active.startY,
      area,
    );
    setPreview(active.frame);
  }

  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const active = gesture.current;

    if (!active || active.pointer !== event.pointerId) {
      return;
    }

    gesture.current = null;
    setPreview(undefined);

    if (!cancelled && active.original !== active.frame) {
      const { x, y, width, height } = active.frame;
      const moved = active.kind === 'move';
      save({
        ...layout,
        width: moved ? layout.width : width,
        x: anchor(x, area.width - width, layout.x, moved),
        y: anchor(y, area.height - height, layout.y, moved),
      });
    }
  }

  return {
    areaRef,
    frame,
    mode: layout.mode,
    moving: preview !== undefined,
    setMode: (mode: BrowserWindowMode) => save({ ...layout, mode }),
    begin,
    pointerEvents: {
      onPointerMove: update,
      onPointerUp: finish,
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, true),
    },
  };
}
