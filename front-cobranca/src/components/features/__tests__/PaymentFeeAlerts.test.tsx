import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { PaymentFeeAlerts } from "../PaymentFeeAlerts";

const financialAdmin = jest.fn();
const api = { financialAdmin };
jest.mock("@/lib/use-api-client", () => ({
  useApiClient: (): typeof api => api,
}));
describe("Payment fee divergence alerts", () => {
  it("displays actionable persisted divergences", async () => {
    financialAdmin.mockResolvedValue({
      total: 1,
      items: [
        {
          id: "alert",
          companyId: "company",
          invoiceId: "invoice",
          createdAt: "2026-09-11T12:00:00Z",
          description: "Tarifa Efí efetiva divergiu da estimativa da emissão.",
        },
      ],
    });
    render(<PaymentFeeAlerts />);
    expect(
      await screen.findByText(
        "Tarifa Efí efetiva divergiu da estimativa da emissão.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Empresa company · Fatura invoice/)).toBeVisible();
  });
  it("shows a friendly failure without provider details", async () => {
    financialAdmin.mockRejectedValue(new Error("internal provider detail"));
    render(<PaymentFeeAlerts />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível consultar as divergências de tarifa.",
    );
    expect(
      screen.queryByText("internal provider detail"),
    ).not.toBeInTheDocument();
  });
});
