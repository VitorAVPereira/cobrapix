import {
  describeLateTerms,
  isIndividualDocument,
  parseLateTermsForm,
} from "../late-terms";

describe("late terms form", () => {
  it("keeps empty fields as null and accepts comma decimals and zero", () => {
    expect(parseLateTermsForm({ fine: "2,5", interest: "", days: "0" })).toEqual(
      { terms: { fine: 2.5, interest: null, days: 0 } },
    );
  });

  it("rejects values outside the limits", () => {
    expect(parseLateTermsForm({ fine: "10.01", interest: "", days: "" })).toHaveProperty("error");
    expect(parseLateTermsForm({ fine: "", interest: "1.234", days: "" })).toHaveProperty("error");
    expect(parseLateTermsForm({ fine: "", interest: "", days: "366" })).toHaveProperty("error");
    expect(parseLateTermsForm({ fine: "-1", interest: "", days: "" })).toHaveProperty("error");
  });

  it("describes the terms and detects individuals", () => {
    expect(describeLateTerms({ fine: 0, interest: 0, days: 0 })).toBe(
      "sem multa, sem juros, pagamento somente até o vencimento",
    );
    expect(describeLateTerms({ fine: 2, interest: 1, days: 30 })).toBe(
      "multa de 2%, juros de 1% ao mês, pagamento aceito até 30 dia(s) após o vencimento",
    );
    expect(isIndividualDocument("123.456.789-09")).toBe(true);
    expect(isIndividualDocument("11.222.333/0001-81")).toBe(false);
  });
});
