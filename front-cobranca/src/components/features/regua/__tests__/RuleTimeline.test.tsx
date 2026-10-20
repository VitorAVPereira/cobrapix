import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { RuleTimeline } from "../RuleTimeline";
import type { RuleDay } from "../rule-days";

function day(value: number, channels: RuleDay["channels"]): RuleDay {
  return {
    key: `k${value}`,
    day: value,
    channels,
    sendTimeStart: "",
    sendTimeEnd: "",
  };
}

const email = { attempted: false, customTemplates: [] };

describe("RuleTimeline", () => {
  it("groups the contacts by phase with their days and channels", () => {
    render(
      <RuleTimeline
        days={[
          day(7, { WHATSAPP: email }),
          day(-3, { EMAIL: email }),
          day(2, { WHATSAPP: email, EMAIL: email }),
        ]}
      />,
    );

    expect(
      screen.getByText("3 contatos com o cliente, o último 7 dias após o vencimento."),
    ).toBeInTheDocument();
    const before = screen.getByRole("listitem", { name: "Antes do vencimento" });
    expect(within(before).getByText("3 dias antes")).toBeInTheDocument();
    expect(within(before).getByLabelText("E-mail")).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem", { name: "No vencimento" })).getByText(
        "Sem contato",
      ),
    ).toBeInTheDocument();
    const after = screen.getByRole("listitem", { name: "Depois do vencimento" });
    expect(
      within(after)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["2 dias após", "7 dias após"]);
    expect(within(after).getAllByLabelText("WhatsApp")).toHaveLength(2);
  });

  it("explains a rule without contacts", () => {
    render(<RuleTimeline days={[]} />);
    expect(
      screen.getByText(
        "Nenhum contato da régua: só a emissão, se pedida no cadastro.",
      ),
    ).toBeInTheDocument();
  });
});
