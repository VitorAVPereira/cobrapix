import { redirect } from "next/navigation";

/** Old address kept for saved links: the screen is now Configurações → Geral. */
export default function LegacyBillingSettingsPage(): never {
  redirect("/configuracoes/geral");
}
