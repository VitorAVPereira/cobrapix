import { redirect } from "next/navigation";

/** The legacy WhatsApp inbox was replaced by the central communications screen. */
export default function LegacyInboxPage(): never {
  redirect("/admin/communications");
}
