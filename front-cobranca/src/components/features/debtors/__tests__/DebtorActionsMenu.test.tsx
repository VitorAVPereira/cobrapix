import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { computePlacement, DebtorActionsMenu } from "../DebtorActionsMenu";
import type { DebtorAction } from "../DebtorActionsMenu";

const rect = (top: number, right: number, height = 36): DOMRect =>
  ({ top, bottom: top + height, right, left: right - 36, width: 36, height, x: right - 36, y: top, toJSON: () => ({}) }) as DOMRect;

describe("computePlacement", () => {
  const viewport = { width: 1366, height: 768 };

  it("opens below the button, right-aligned, 224 px wide", () => {
    expect(computePlacement(rect(100, 1300), 200, viewport)).toEqual({
      top: 140,
      left: 1076,
      width: 224,
      maxHeight: 768 - 136 - 4 - 8,
    });
  });

  it("opens above the last row when the space below is short", () => {
    const placement = computePlacement(rect(700, 1300), 200, viewport);
    expect(placement.top).toBe(700 - 4 - 200);
    expect(placement.top + 200).toBeLessThanOrEqual(700);
  });

  it("keeps an 8 px margin from the window on narrow screens", () => {
    const placement = computePlacement(rect(100, 40), 200, { width: 375, height: 812 });
    expect(placement.left).toBe(8);
    expect(placement.left + placement.width).toBeLessThanOrEqual(375 - 8);
    const tiny = computePlacement(rect(100, 150), 200, { width: 200, height: 812 });
    expect(tiny.width).toBe(184);
    expect(tiny.left).toBe(8);
  });

  it("limits the height to the window, scrolling inside, when nothing fits", () => {
    const placement = computePlacement(rect(200, 1300), 900, { width: 1366, height: 500 });
    // More room below (500-236-12=252) than above (188): opens below, capped.
    expect(placement.top).toBe(240);
    expect(placement.maxHeight).toBe(252);
  });
});

function Harness({ actions, inClippedTable = true }: { actions: DebtorAction[]; inClippedTable?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div data-testid="clip" style={{ overflow: inClippedTable ? "auto" : "visible" }}>
        {["Maria"].map((row) => (
          <button
            key={row}
            type="button"
            aria-label={`Abrir acoes do cliente ${row}`}
            onClick={(event) => {
              setAnchor(event.currentTarget);
              setOpen((current) => !current);
            }}
          >
            ⋮
          </button>
        ))}
      </div>
      <DebtorActionsMenu open={open} anchor={anchor} onClose={() => setOpen(false)} actions={actions} label="Acoes do cliente Maria" />
    </div>
  );
}

const actions = () => [
  { id: "edit", label: "Editar cliente", onSelect: jest.fn() },
  { id: "disabled", label: "Indisponivel", disabled: true, onSelect: jest.fn() },
  { id: "charge", label: "Nova cobranca", onSelect: jest.fn() },
];

it("renders outside the clipping table container, anchored to its button", async () => {
  const user = userEvent.setup();
  render(<Harness actions={actions()} />);
  const button = screen.getByRole("button", { name: /abrir acoes/i });
  await user.click(button);
  const menu = screen.getByRole("menu", { name: "Acoes do cliente Maria" });
  expect(screen.getByTestId("clip")).not.toContainElement(menu);
  expect(menu.parentElement).toBe(document.body);
  expect(menu.style.position).toBe("fixed");
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(button).toHaveAttribute("aria-controls", menu.id);
});

it("focuses the first action and moves with the keyboard, skipping disabled ones", async () => {
  const user = userEvent.setup();
  render(<Harness actions={actions()} />);
  await user.click(screen.getByRole("button", { name: /abrir acoes/i }));
  expect(screen.getByRole("menuitem", { name: "Editar cliente" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Nova cobranca" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Editar cliente" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("menuitem", { name: "Nova cobranca" })).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByRole("menuitem", { name: "Editar cliente" })).toHaveFocus();
});

it("closes on Escape and returns focus to its button", async () => {
  const user = userEvent.setup();
  render(<Harness actions={actions()} />);
  const button = screen.getByRole("button", { name: /abrir acoes/i });
  await user.click(button);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "false");
});

it("runs the chosen action once and closes without taking focus back", async () => {
  const user = userEvent.setup();
  const list = actions();
  render(<Harness actions={list} />);
  const button = screen.getByRole("button", { name: /abrir acoes/i });
  await user.click(button);
  await user.click(screen.getByRole("menuitem", { name: "Nova cobranca" }));
  expect(list[2]!.onSelect).toHaveBeenCalledTimes(1);
  expect(list[0]!.onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).toBeNull();
  // A modal opened by the action keeps the focus it takes.
  expect(button).not.toHaveFocus();
});

it("closes on a click outside", async () => {
  const user = userEvent.setup();
  render(<Harness actions={actions()} />);
  await user.click(screen.getByRole("button", { name: /abrir acoes/i }));
  await user.click(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("closes when its row disappears or scrolls out of view", async () => {
  const user = userEvent.setup();
  render(<Harness actions={actions()} />);
  const button = screen.getByRole("button", { name: /abrir acoes/i });
  await user.click(button);
  jest.spyOn(button, "getBoundingClientRect").mockReturnValue(rect(-200, 300));
  act(() => {
    fireEvent.scroll(window);
  });
  expect(screen.queryByRole("menu")).toBeNull();

  (button.getBoundingClientRect as jest.Mock).mockReturnValue(rect(100, 300));
  await user.click(button);
  expect(screen.getByRole("menu")).toBeInTheDocument();
  // The row leaves the document (filtered or paged) while the menu is open.
  act(() => {
    button.remove();
    fireEvent.scroll(window);
  });
  expect(screen.queryByRole("menu")).toBeNull();
});
