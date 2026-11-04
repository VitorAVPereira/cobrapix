"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2, Package, Plus } from "lucide-react";
import type { CheckoutProduct } from "@/lib/api-client";
import { useApiClient } from "@/lib/use-api-client";
import { formatCents } from "@/lib/disbursements";
import { checkoutLink } from "@/lib/checkout";
import { ProductForm } from "@/components/features/checkout/ProductForm";
import { buttonClass, messageOf } from "@/components/features/checkout/ui";

type Filter = "all" | "active" | "inactive";

export default function CheckoutProductsPage() {
  const api = useApiClient();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [products, setProducts] = useState<CheckoutProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function load(change: () => void): void {
    setProducts(null);
    setError(null);
    change();
  }

  useEffect(() => {
    // A slower answer for a previous filter must not replace the current one.
    const controller = new AbortController();
    api
      .listCheckoutProducts(filter === "all" ? undefined : filter === "active", controller.signal)
      .then((result) => setProducts(result))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(messageOf(caught, "Não foi possível carregar os produtos."));
      });
    return () => controller.abort();
  }, [api, filter, reload]);

  async function copy(slug: string) {
    await navigator.clipboard?.writeText(checkoutLink(slug));
    setCopied(slug);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <Package size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Produtos</h1>
            <p className="text-sm text-slate-500">
              O que você vende no checkout. A página de pagamento de cada link será liberada em breve.
            </p>
          </div>
        </div>
        <button type="button" className={buttonClass} onClick={() => setCreating((open) => !open)}>
          <Plus size={16} /> Novo produto
        </button>
      </header>

      {creating && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Novo produto</h2>
          <ProductForm
            submitLabel="Criar produto"
            onSubmit={async (input) => {
              const product = await api.createCheckoutProduct(input);
              router.push(`/checkout/produtos/${product.id}`);
            }}
          />
        </section>
      )}

      <div className="flex gap-2" role="group" aria-label="Filtrar produtos">
        {(
          [
            ["all", "Todos"],
            ["active", "Ativos"],
            ["inactive", "Inativos"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              filter === value ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => load(() => setFilter(value))}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
          <button
            type="button"
            className="ml-auto font-semibold underline"
            onClick={() => load(() => setReload((value) => value + 1))}
          >
            Tentar de novo
          </button>
        </div>
      ) : products === null ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Carregando produtos…
        </p>
      ) : products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {filter === "all" ? "Nenhum produto cadastrado ainda." : "Nenhum produto neste filtro."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
          {products.map((product) => (
            <li key={product.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="font-semibold text-slate-900">
                  {product.name}
                  {!product.active && (
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Inativo
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-500">
                  {product.compareAtPriceCents && (
                    <span className="mr-1 line-through">{formatCents(product.compareAtPriceCents)}</span>
                  )}
                  {formatCents(product.priceCents)} · {product._count?.bumps ?? 0} order bump(s) ativo(s)
                </p>
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  {checkoutLink(product.slug)}
                  <button
                    type="button"
                    aria-label={`Copiar link de ${product.name}`}
                    className="text-emerald-700 hover:text-emerald-800"
                    onClick={() => void copy(product.slug)}
                  >
                    <Copy size={14} />
                  </button>
                  {copied === product.slug && <span className="text-emerald-700">Copiado</span>}
                </p>
              </div>
              <Link
                href={`/checkout/produtos/${product.id}`}
                className="text-sm font-semibold text-emerald-700 hover:underline"
              >
                Editar e order bumps
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
