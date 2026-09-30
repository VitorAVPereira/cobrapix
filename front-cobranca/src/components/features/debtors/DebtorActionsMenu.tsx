"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

export interface DebtorAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect(): void;
}

interface DebtorActionsMenuProps {
  open: boolean;
  anchor: HTMLButtonElement | null;
  onClose(): void;
  actions: DebtorAction[];
  label: string;
}

const MENU_WIDTH = 224;
const VIEWPORT_MARGIN = 8;
const GAP = 4;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

// Fixed to the viewport next to its button: no scrolling or clipping ancestor
// (the table's overflow-x-auto) can cut it. Opens upward when there is more
// room above, and scrolls inside when the window itself is too small.
export function computePlacement(
  anchor: DOMRect,
  menuHeight: number,
  viewport: { width: number; height: number },
): Placement {
  const width = Math.min(MENU_WIDTH, viewport.width - 2 * VIEWPORT_MARGIN);
  const left = Math.min(
    Math.max(anchor.right - width, VIEWPORT_MARGIN),
    viewport.width - width - VIEWPORT_MARGIN,
  );
  const below = viewport.height - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const above = anchor.top - GAP - VIEWPORT_MARGIN;
  if (menuHeight <= below || below >= above) {
    return { top: anchor.bottom + GAP, left, width, maxHeight: Math.max(below, 0) };
  }
  const height = Math.min(menuHeight, above);
  return { top: anchor.top - GAP - height, left, width, maxHeight: Math.max(above, 0) };
}

export function DebtorActionsMenu({ open, anchor, onClose, actions, label }: DebtorActionsMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const menuId = useId();

  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    // A row removed, filtered or paged out takes its menu with it.
    if (!anchor.isConnected) {
      onClose();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // The button scrolled out of view: the menu would float detached from it.
    if (rect.bottom < 0 || rect.top > viewport.height) {
      onClose();
      return;
    }
    // Full content height plus borders, even while capped by maxHeight.
    const height = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
    setPlacement(computePlacement(rect, height, viewport));
  }, [anchor, onClose]);

  // Placed before paint, so it never shows at a stale position.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, actions.length]);

  useEffect(() => {
    if (!open || !anchor) return;
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", menuId);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      anchor.setAttribute("aria-expanded", "false");
      anchor.removeAttribute("aria-controls");
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, anchor, menuId, onClose, place]);

  // First enabled action gets focus once the menu is placed.
  useEffect(() => {
    if (!open || !placement) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (first && !menuRef.current?.contains(document.activeElement)) first.focus();
  }, [open, placement]);

  if (!open || !anchor || typeof document === "undefined") return null;

  function items(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      // Back to the button that opened it (only here: an action may open a modal).
      anchor?.focus();
    } else if (event.key === "Tab") onClose();
  }

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={
        placement
          ? { position: "fixed", top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }
          : { position: "fixed", top: 0, left: 0, width: MENU_WIDTH, visibility: "hidden" }
      }
      className="z-50 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          tabIndex={-1}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-slate-100 focus:outline-none disabled:opacity-50"
        >
          {action.icon}
          <span className="min-w-0 break-words">{action.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
