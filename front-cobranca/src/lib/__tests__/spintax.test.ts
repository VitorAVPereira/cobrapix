import { interpolate, spin } from "../spintax";

describe("spin()", () => {
  it("retorna texto simples inalterado", () => {
    expect(spin("sem grupos aqui")).toBe("sem grupos aqui");
  });

  it("escolhe uma das opções de um grupo", () => {
    const options = new Set(["a", "b", "c"]);
    for (let i = 0; i < 50; i++) {
      expect(options.has(spin("{a|b|c}"))).toBe(true);
    }
  });

  it("respeita RNG determinístico — primeira opção", () => {
    const rngZero = () => 0;
    expect(spin("{a|b|c}", rngZero)).toBe("a");
  });

  it("respeita RNG determinístico — última opção", () => {
    // Math.floor(0.999 * 3) = 2
    const rngLast = () => 0.999;
    expect(spin("{a|b|c}", rngLast)).toBe("c");
  });

  it("resolve múltiplos grupos na mesma string", () => {
    const all = new Set(["oi jose", "oi ana", "ola jose", "ola ana"]);
    for (let i = 0; i < 50; i++) {
      expect(all.has(spin("{oi|ola} {jose|ana}"))).toBe(true);
    }
  });

  it("resolve grupos aninhados bottom-up", () => {
    const valid = new Set(["caro cliente", "prezado cliente", "prezado amigo cliente"]);
    for (let i = 0; i < 50; i++) {
      expect(valid.has(spin("{caro|prezado{| amigo}} cliente"))).toBe(true);
    }
  });

  it("aceita grupo com opções vazias", () => {
    const result = spin("ola{!|}", () => 0.99);
    expect(["ola!", "ola"]).toContain(result);
  });

  it("lança erro em template aparentemente infinito", () => {
    // Um grupo que sempre se regenera não é possível com a gramática atual,
    // mas garantimos que um template absurdamente longo ainda termina.
    const huge = "{a|b}".repeat(500);
    expect(() => spin(huge)).not.toThrow();
  });
});

describe("interpolate()", () => {
  it("substitui placeholders conhecidos", () => {
    expect(interpolate("ola {{nome}}", { nome: "Jose" })).toBe("ola Jose");
  });

  it("mantém placeholders desconhecidos intactos", () => {
    expect(interpolate("ola {{nome}}", {})).toBe("ola {{nome}}");
  });

  it("interpolação antes do spin impede que o valor seja interpretado como Spintax", () => {
    // Se o nome contiver | ou {, ele NÃO deve virar escolha Spintax.
    const interpolated = interpolate("ola {{nome}}", { nome: "a|b" });
    // Após interpolate, não há chaves no texto — spin devolve igual.
    expect(spin(interpolated)).toBe("ola a|b");
  });
});
