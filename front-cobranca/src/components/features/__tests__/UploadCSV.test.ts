import { parseInvoiceCsvRows } from "../UploadCSV";

describe("parseInvoiceCsvRows", () => {
  it("aceita coluna cpf_cnpj como documento do devedor", () => {
    expect(
      parseInvoiceCsvRows([
        {
          Nome: "Maria Silva",
          cpf_cnpj: "123.456.789-09",
          WhatsApp: "+5511999999999",
          Email: "maria@email.com",
          Valor: "150,50",
          Vencimento: "2026-12-01",
          "Forma de Pagamento": "PIX",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        name: "Maria Silva",
        document: "12345678909",
      }),
    ]);
  });

  it("aceita coluna cpfCnpj como documento do devedor", () => {
    expect(
      parseInvoiceCsvRows([
        {
          Nome: "Escola Modelo Ltda",
          cpfCnpj: "11.222.333/0001-81",
          WhatsApp: "+5511999999999",
          Email: "financeiro@escola.com",
          Valor: "250.00",
          Vencimento: "2026-12-01",
          "Forma de Pagamento": "BOLIX",
        },
      ])[0]?.document,
    ).toBe("11222333000181");
  });

  it("rejeita documento fake no CSV", () => {
    expect(() =>
      parseInvoiceCsvRows([
        {
          Nome: "Maria Silva",
          document: "000.000.000-00",
          WhatsApp: "+5511999999999",
          Email: "maria@email.com",
          Valor: "150,50",
          Vencimento: "2026-12-01",
          "Forma de Pagamento": "PIX",
        },
      ]),
    ).toThrow("CPF/CNPJ");
  });

  it("rejeita CPF com digitos verificadores invalidos no CSV", () => {
    expect(() =>
      parseInvoiceCsvRows([
        {
          Nome: "Maria Silva",
          document: "123.456.789-00",
          WhatsApp: "+5511999999999",
          Email: "maria@email.com",
          Valor: "150,50",
          Vencimento: "2026-12-01",
          "Forma de Pagamento": "PIX",
        },
      ]),
    ).toThrow("CPF/CNPJ");
  });
});

it("rejeita boleto tradicional em novas importações", () => {
  expect(() => parseInvoiceCsvRows([{Nome: "Maria Silva", cpf_cnpj: "12345678909", WhatsApp: "+5511999999999", Email: "maria@email.com", Valor: "150", Vencimento: "2026-12-01", "Forma de Pagamento": "BOLETO"}])).toThrow("Use PIX ou BOLIX");
});

describe("parseInvoiceCsvRows late terms", () => {
  const base = {
    Nome: "Maria Silva",
    cpf_cnpj: "529.982.247-25",
    WhatsApp: "+5511999999999",
    Email: "maria@email.com",
    Valor: "100",
    Vencimento: "2026-12-01",
    "Forma de Pagamento": "PIX",
  };

  it("reads optional fine, interest and days; empty keeps the company default", () => {
    const [withTerms, withoutTerms] = parseInvoiceCsvRows([
      {
        ...base,
        "Multa (%)": "2,5",
        "Juros ao mês (%)": "1",
        "Dias após vencimento": "0",
      },
      { ...base, "Multa (%)": "", "Juros ao mês (%)": "" },
    ]);
    expect(withTerms).toMatchObject({
      late_fine_percentage: 2.5,
      late_interest_monthly_percentage: 1,
      payment_days_after_due: 0,
    });
    expect(withoutTerms?.late_fine_percentage).toBeUndefined();
    expect(withoutTerms?.late_interest_monthly_percentage).toBeUndefined();
    expect(withoutTerms?.payment_days_after_due).toBeUndefined();
  });

  it("rejects a fine above 10%", () => {
    expect(() =>
      parseInvoiceCsvRows([{ ...base, "Multa (%)": "15" }]),
    ).toThrow("Linha 2: Multa deve estar entre 0 e 10%");
  });
});
