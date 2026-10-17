import {
  formatDateTime,
  importErrors,
  parseAmountToCents,
  parseBatchCsv,
  parseRecipientsCsv,
} from "../disbursements";

describe("collaborator payments helpers", () => {
  it.each([
    ["1.500,00", 150000],
    ["1500,5", 150050],
    ["1500.50", 150050],
    ["R$ 980", 98000],
    ["0,01", 1],
  ])("reads %s as %i cents", (raw, cents) => {
    expect(parseAmountToCents(raw)).toBe(cents);
  });

  it.each(["", "abc", "0", "1.500", "10,123", "-5"])(
    "refuses %s as an amount",
    (raw) => {
      expect(parseAmountToCents(raw)).toBeNull();
    },
  );

  it("shows the deadline in São Paulo time", () => {
    expect(formatDateTime("2026-10-16T17:30:00.000Z")).toBe(
      "16/10/2026 às 14:30",
    );
  });

  it("reads collaborators by key or by bank account, ignoring accents in headers", () => {
    expect(
      parseRecipientsCsv([
        { Nome: "Ana", "CPF/CNPJ": "52998224725", "Chave Pix": "ana@x.com" },
        {
          Nome: "Prestador",
          "CPF/CNPJ": "11222333000181",
          "ISPB do banco": "09089356",
          Agência: "1",
          Conta: "123453",
          "Tipo de conta": "CACC",
        },
      ]),
    ).toEqual([
      { name: "Ana", document: "52998224725", pixKey: "ana@x.com" },
      {
        name: "Prestador",
        document: "11222333000181",
        bankIspb: "09089356",
        bankAgency: "1",
        bankAccount: "123453",
        bankAccountType: "cacc",
      },
    ]);
  });

  it("matches batch lines to active collaborators and lists every problem by line", () => {
    const byDocument = new Map([
      ["52998224725", { id: "ana" }],
      ["11222333000181", { id: "prestador" }],
    ]);
    expect(
      parseBatchCsv(
        [
          { "CPF/CNPJ": "529.982.247-25", Valor: "1.500,00" },
          { "CPF/CNPJ": "11222333000181", Valor: "abc" },
          { "CPF/CNPJ": "99999999999", Valor: "10" },
          { "CPF/CNPJ": "52998224725", Valor: "10" },
        ],
        byDocument,
      ),
    ).toEqual({
      items: [{ recipientId: "ana", amountCents: 150000 }],
      errors: [
        "Linha 3: valor inválido.",
        "Linha 4: CPF/CNPJ sem colaborador ativo cadastrado.",
        "Linha 5: colaborador repetido na planilha.",
      ],
    });
  });

  it("turns server import errors (rows) into spreadsheet lines", () => {
    expect(
      importErrors({
        code: "IMPORT_INVALID",
        errors: [{ row: 2, message: "CPF ou CNPJ inválido." }],
      }),
    ).toEqual(["Linha 3: CPF ou CNPJ inválido."]);
    expect(importErrors({ message: "x" })).toEqual([]);
  });
});
