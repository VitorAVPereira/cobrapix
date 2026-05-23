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
          "Forma de Pagamento": "BOLETO",
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
