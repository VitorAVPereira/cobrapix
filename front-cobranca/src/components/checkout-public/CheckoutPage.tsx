"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  CheckoutPublicError,
  getCheckoutProduct,
  type PublicCheckoutProduct,
} from "@/lib/checkout-public";
import { CheckoutForm } from "./CheckoutForm";
import { CheckoutShell } from "./CheckoutShell";

type Loaded =
  | { kind: "loading" }
  | { kind: "ok"; data: PublicCheckoutProduct }
  | { kind: "missing" }
  | { kind: "error" };

export function CheckoutPage({ slug }: { slug: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getCheckoutProduct(slug, controller.signal)
      .then((data) => setLoaded({ kind: "ok", data }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded(
          caught instanceof CheckoutPublicError && caught.status === 404 ? { kind: "missing" } : { kind: "error" },
        );
      });
    return () => controller.abort();
  }, [slug]);

  if (loaded.kind === "loading")
    return (
      <CheckoutShell page={null}>
        <p className="flex items-center justify-center gap-2 py-20 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </p>
      </CheckoutShell>
    );
  if (loaded.kind !== "ok")
    return (
      <CheckoutShell page={null}>
        <p role="alert" className="rounded-lg bg-white p-6 text-center text-slate-700 shadow-sm">
          {loaded.kind === "missing"
            ? "Este produto não está disponível."
            : "Não foi possível carregar a página. Confira sua conexão e tente de novo."}
        </p>
      </CheckoutShell>
    );
  const { data } = loaded;
  return (
    <CheckoutShell page={data.page}>
      {data.available ? (
        <CheckoutForm data={data} />
      ) : (
        <p role="alert" className="rounded-lg bg-white p-6 text-center text-slate-700 shadow-sm">
          {data.unavailableMessage}
        </p>
      )}
    </CheckoutShell>
  );
}
