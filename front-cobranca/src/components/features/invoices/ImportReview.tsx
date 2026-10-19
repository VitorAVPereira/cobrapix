"use client";

import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import type {
  ImportClientData,
  ImportClientReview,
  ImportDecision,
  ImportExistingClient,
  ImportField,
} from "@/lib/api-client";
import { formatWhatsAppNumber } from "@/lib/whatsapp-number";
import { formatDebtorDocument as formatDocument } from "@/lib/debtor-document";

type Choice = Record<ImportField, "CSV" | "EXISTING">;
type Rules = Partial<{
  DIFFERENT: Choice;
  UNDOCUMENTED_OWNER: Choice | "SKIP";
  PHONE_TAKEN: "SKIP";
  DUPLICATE_DOCUMENT: "SKIP";
}>;

const FIELD_LABELS: Record<ImportField, string> = {
  name: "Nome",
  phone: "WhatsApp",
  email: "E-mail",
};
const KEEP_ALL: Choice = { name: "EXISTING", phone: "EXISTING", email: "EXISTING" };

/** Same number with or without the Brazilian country code. */
function samePhone(a: string, b: string): boolean {
  const local = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits;
  };
  return local(a) === local(b);
}

/** Same comparison as the server: an empty e-mail in the spreadsheet is not a difference. */
export function importDifferences(
  existing: ImportClientData,
  csv: ImportClientData,
): ImportField[] {
  return (["name", "phone", "email"] as const).filter((field) => {
    if (field === "phone") return !samePhone(existing.phone, csv.phone);
    if (field === "email") return csv.email !== null && csv.email !== existing.email;
    return csv.name !== existing.name;
  });
}

function show(field: ImportField, value: string | null): string {
  if (!value) return "—";
  return field === "phone" ? formatWhatsAppNumber(value) : value;
}

/** The spreadsheet WhatsApp can only be kept if no other client has it. */
function phoneAvailable(client: ImportClientReview, chosen: ImportExistingClient): boolean {
  return !client.phoneOwner || client.phoneOwner.debtorId === chosen.debtorId;
}

function link(
  client: ImportClientReview,
  chosen: ImportExistingClient,
  choice: Choice,
): ImportDecision {
  return {
    document: client.document,
    action: "LINK",
    debtorId: chosen.debtorId,
    version: chosen.version,
    use: { ...choice, phone: phoneAvailable(client, chosen) ? choice.phone : "EXISTING" },
  };
}

export function ImportReview({
  clients,
  onValidatePhone,
  onComplete,
  onCancel,
}: {
  clients: ImportClientReview[];
  /** Checks a replacement WhatsApp; returns an error message, or null once applied. */
  onValidatePhone: (client: ImportClientReview, phone: string) => Promise<string | null>;
  onComplete: (decisions: ImportDecision[]) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<ImportDecision[]>([]);
  const [rules, setRules] = useState<Rules>({});
  const [choice, setChoice] = useState<Choice>(KEEP_ALL);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  // Older client without document: link to them, or register a new client.
  const [ownerAction, setOwnerAction] = useState<"link" | "phone">("link");

  const client = clients[index];
  if (!client) return null;

  /** Records the decision (if any) and skips the next clients a rule already decides. */
  function next(decision: ImportDecision | null, nextRules: Rules): void {
    const done = decision ? [...decisions, decision] : [...decisions];
    let position = index + 1;
    for (; position < clients.length; position += 1) {
      const upcoming = clients[position];
      if (!upcoming) break;
      const ownerRule = nextRules.UNDOCUMENTED_OWNER;
      if (upcoming.kind === "DIFFERENT" && nextRules.DIFFERENT) {
        done.push(link(upcoming, upcoming.existing, nextRules.DIFFERENT));
      } else if (upcoming.kind === "UNDOCUMENTED_OWNER" && ownerRule) {
        done.push(
          ownerRule === "SKIP"
            ? { document: upcoming.document, action: "SKIP" }
            : link(upcoming, upcoming.existing, ownerRule),
        );
      } else if (upcoming.kind === "PHONE_TAKEN" && nextRules.PHONE_TAKEN) {
        done.push({ document: upcoming.document, action: "SKIP" });
      } else if (upcoming.kind === "DUPLICATE_DOCUMENT" && nextRules.DUPLICATE_DOCUMENT) {
        done.push({ document: upcoming.document, action: "SKIP" });
      } else {
        break;
      }
    }
    if (position >= clients.length) {
      onComplete(done);
      return;
    }
    setDecisions(done);
    setRules(nextRules);
    setIndex(position);
    setChoice(KEEP_ALL);
    setCandidateId(null);
    setApplyAll(false);
    setNewPhone("");
    setPhoneError(null);
    setOwnerAction("link");
  }

  function skip(): void {
    const kind = client.kind as keyof Rules;
    next(
      { document: client.document, action: "SKIP" },
      applyAll && kind !== "DIFFERENT" ? { ...rules, [kind]: "SKIP" } : rules,
    );
  }

  async function applyNewPhone(): Promise<void> {
    setValidating(true);
    setPhoneError(null);
    const error = await onValidatePhone(client, newPhone);
    setValidating(false);
    if (error) setPhoneError(error);
    else next(null, rules);
  }

  const chosen =
    client.kind === "DIFFERENT" ||
    (client.kind === "UNDOCUMENTED_OWNER" && ownerAction === "link")
      ? client.existing
      : client.kind === "DUPLICATE_DOCUMENT"
        ? client.candidates.find((candidate) => candidate.debtorId === candidateId)
        : undefined;
  const differences =
    client.kind === "DIFFERENT" || client.kind === "UNDOCUMENTED_OWNER"
      ? client.differences
      : chosen
        ? importDifferences(chosen, client.csv)
        : [];
  const charges = client.rows.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-review-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Cliente {index + 1} de {clients.length}
            </p>
            <h2 id="import-review-title" className="mt-1 font-semibold text-slate-900">
              {client.csv.name}
            </h2>
            <p className="text-sm text-slate-500">
              {formatDocument(client.document)} · {charges}{" "}
              {charges === 1 ? "cobrança na planilha" : "cobranças na planilha"}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar importação"
            className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5 text-sm">
          {client.kind === "UNDOCUMENTED_OWNER" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-slate-700">
                Este CPF/CNPJ é novo, mas o WhatsApp{" "}
                <strong>{formatWhatsAppNumber(client.csv.phone)}</strong> é de{" "}
                <strong>{client.existing.name}</strong>, cadastrado sem CPF/CNPJ.
              </legend>
              <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                <input
                  type="radio"
                  name="owner-action"
                  checked={ownerAction === "link"}
                  onChange={() => setOwnerAction("link")}
                  className="mt-1"
                />
                <span>
                  Vincular a {client.existing.name} e gravar este CPF/CNPJ no cadastro
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                <input
                  type="radio"
                  name="owner-action"
                  checked={ownerAction === "phone"}
                  onChange={() => setOwnerAction("phone")}
                  className="mt-1"
                />
                <span>Cadastrar como cliente novo, com outro WhatsApp</span>
              </label>
            </fieldset>
          )}

          {(client.kind === "PHONE_TAKEN" ||
            (client.kind === "UNDOCUMENTED_OWNER" && ownerAction === "phone")) && (
            <>
              {client.kind === "PHONE_TAKEN" && (
              <p className="text-slate-700">
                Este CPF/CNPJ é novo, mas o WhatsApp{" "}
                <strong>{formatWhatsAppNumber(client.csv.phone)}</strong> já é de{" "}
                <strong>{client.phoneOwner?.name}</strong>. Informe outro WhatsApp para
                cadastrar o cliente ou não importe as cobranças dele.
              </p>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-slate-500">
                  Outro WhatsApp
                </span>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(event) => setNewPhone(event.target.value)}
                    placeholder="+55 (11) 99999-9999"
                    className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  />
                  <button
                    type="button"
                    disabled={!newPhone.trim() || validating}
                    onClick={() => void applyNewPhone()}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {validating && <Loader2 size={15} className="animate-spin" />}
                    Usar este WhatsApp
                  </button>
                </div>
              </label>
              {phoneError && (
                <p role="alert" className="flex items-start gap-2 text-rose-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {phoneError}
                </p>
              )}
            </>
          )}

          {client.kind === "DUPLICATE_DOCUMENT" && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-slate-700">
                Há {client.candidates.length} clientes cadastrados com este CPF/CNPJ. Escolha a
                qual vincular as cobranças.
              </legend>
              {client.candidates.map((candidate) => (
                <label
                  key={candidate.debtorId}
                  className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2.5 hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={candidateId === candidate.debtorId}
                    onChange={() => {
                      setCandidateId(candidate.debtorId);
                      setChoice(KEEP_ALL);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{candidate.name}</span>
                    <span className="block text-xs text-slate-500">
                      {formatWhatsAppNumber(candidate.phone)} · {candidate.email ?? "Sem e-mail"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {chosen && client.kind === "DIFFERENT" && (
            <p className="text-slate-700">
              Este CPF/CNPJ já está cadastrado com dados diferentes. Escolha o que manter.
            </p>
          )}

          {chosen && differences.length > 0 && (
            <table className="w-full table-fixed text-left">
              <thead className="text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="w-24 py-2">Campo</th>
                  <th className="py-2">Cadastro</th>
                  <th className="py-2">Planilha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {differences.map((field) => {
                  const csvBlocked = field === "phone" && !phoneAvailable(client, chosen);
                  return (
                    <tr key={field}>
                      <th scope="row" className="py-2.5 font-medium text-slate-700">
                        {FIELD_LABELS[field]}
                      </th>
                      <td className="py-2.5 pr-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`field-${field}`}
                            aria-label={`Manter ${FIELD_LABELS[field]} do cadastro`}
                            checked={choice[field] === "EXISTING"}
                            onChange={() => setChoice({ ...choice, [field]: "EXISTING" })}
                            className="mt-1"
                          />
                          <span className="break-words">{show(field, chosen[field])}</span>
                        </label>
                      </td>
                      <td className="py-2.5">
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`field-${field}`}
                            aria-label={`Usar ${FIELD_LABELS[field]} da planilha`}
                            disabled={csvBlocked}
                            checked={choice[field] === "CSV"}
                            onChange={() => setChoice({ ...choice, [field]: "CSV" })}
                            className="mt-1"
                          />
                          <span className="break-words">
                            {show(field, client.csv[field])}
                            {csvBlocked && (
                              <span className="block text-xs text-slate-500">
                                Já é de {client.phoneOwner?.name}.
                              </span>
                            )}
                          </span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {chosen && differences.length === 0 && (
            <p className="text-slate-700">Os dados da planilha são iguais aos do cadastro.</p>
          )}

          <label className="flex items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(event) => setApplyAll(event.target.checked)}
            />
            {client.kind === "DIFFERENT"
              ? "Aplicar esta escolha a todos os próximos clientes com dados diferentes"
              : client.kind === "UNDOCUMENTED_OWNER"
                ? "Aplicar esta escolha aos próximos clientes antigos sem CPF/CNPJ"
                : "Não importar os próximos clientes nesta mesma situação"}
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={skip}
            className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Não importar este cliente
          </button>
          {chosen && (
            <button
              type="button"
              onClick={() =>
                next(
                  link(client, chosen, choice),
                  applyAll &&
                    (client.kind === "DIFFERENT" || client.kind === "UNDOCUMENTED_OWNER")
                    ? { ...rules, [client.kind]: choice }
                    : rules,
                )
              }
              className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Confirmar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
