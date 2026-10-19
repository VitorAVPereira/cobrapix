import { redirect } from "next/navigation";

/** Old address kept for saved links: the screen moved to the Portuguese route. */
export default function LegacyCentralInboxPage(): never {
  redirect("/admin/comunicacoes");
}
