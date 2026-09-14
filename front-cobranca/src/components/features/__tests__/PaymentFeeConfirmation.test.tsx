import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentFeeConfirmation } from "../PaymentFeeConfirmation";

describe("Payment fee confirmation", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function (): void {
      this.open = true;
    };
  });
  const quote = {
    billingMethod: "BOLIX" as const,
    grossAmountCents: 10000,
    totalFeeCents: 369,
    netAmountCents: 9631,
    feeLabel: "R$ 1,19 + 2,50%",
    feeVersionId: "fee",
    feeVersion: 2,
  };
  it("shows the combined fee and requires a chosen replacement date", async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    render(
      <PaymentFeeConfirmation
        quote={quote}
        replacing
        busy={false}
        onCancel={jest.fn()}
        onConfirm={confirm}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Substituir cobrança vencida" }),
    ).toBeVisible();
    expect(screen.getByText("Valor bruto")).toBeVisible();
    expect(screen.getByText("R$ 1,19 + 2,50%")).toBeVisible();
    expect(screen.getByText("Líquido estimado")).toBeVisible();
    expect(screen.queryByText("Taxa CifraMais")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar anterior e emitir nova" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Novo vencimento"), {
      target: { value: "2099-12-31" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Cancelar anterior e emitir nova" }),
    );
    expect(confirm).toHaveBeenCalledWith("2099-12-31");
  });
  it("does not submit a past replacement date", async () => {
    const confirm = jest.fn().mockResolvedValue(undefined);
    render(
      <PaymentFeeConfirmation
        quote={quote}
        replacing
        busy={false}
        onCancel={jest.fn()}
        onConfirm={confirm}
      />,
    );
    fireEvent.change(screen.getByLabelText("Novo vencimento"), {
      target: { value: "2000-01-01" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Cancelar anterior e emitir nova" }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});
