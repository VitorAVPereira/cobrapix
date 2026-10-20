import { Fragment } from "react";
import type { ReactNode } from "react";
import { Copy, ExternalLink, MessageCircle, Reply } from "lucide-react";
import type { TemplateContentView } from "./types";

export type PreviewButton = { label: string; kind: "link" | "copy" | "reply" };

/** Buttons of an approved template in the order the payer sees them. */
export function previewButtons(content: TemplateContentView): PreviewButton[] {
  const indexed: Array<PreviewButton & { index: number }> = [];
  if (content.button)
    indexed.push({
      index: content.button.index ?? 0,
      label: content.button.label,
      kind: "link",
    });
  if (content.pixButton) indexed.push({ ...content.pixButton, kind: "copy" });
  if (content.boletoButton)
    indexed.push({ ...content.boletoButton, kind: "copy" });
  return [
    ...indexed
      .sort((x, y) => x.index - y.index)
      .map(({ label, kind }) => ({ label, kind })),
    ...(content.quickReplies ?? []).map((label): PreviewButton => ({
      label,
      kind: "reply",
    })),
  ];
}

/** WhatsApp *bold* and _italic_ inside one line, without interpreting any HTML. */
function formatted(line: string): ReactNode[] {
  return line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, index) => {
    if (/^\*[^*]+\*$/.test(part))
      return <strong key={index}>{part.slice(1, -1)}</strong>;
    if (/^_[^_]+_$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const ICONS = { link: ExternalLink, copy: Copy, reply: Reply } as const;

/**
 * How a message reaches the payer on WhatsApp, drawn with example data. It is a picture
 * of the message (role="img"); its buttons are not controls.
 */
export function WhatsappMessagePreview({
  body,
  footer,
  buttons,
  time = "09:12",
  label,
}: {
  body: string;
  footer?: string | null;
  buttons: PreviewButton[];
  time?: string;
  label: string;
}): ReactNode {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return (
    <div
      role="img"
      aria-label={label}
      className="flex flex-col gap-3 rounded-2xl bg-[#e8f1ec] px-4 pb-5 pt-4"
    >
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#44504e]">
        <MessageCircle size={14} aria-hidden />
        Cifra+ · WhatsApp
      </div>
      <div className="flex w-[94%] flex-col gap-2.5 rounded-[4px_16px_16px_16px] bg-white px-3.5 pt-3 text-[13.5px] leading-snug text-[#154943] shadow-[0_6px_18px_-12px_rgba(8,39,34,0.45)]">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line break-words">
            {paragraph.split("\n").map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && "\n"}
                {formatted(line)}
              </Fragment>
            ))}
          </p>
        ))}
        {footer && <p className="text-[12.5px] text-[#5e6f6b]">{footer}</p>}
        <span className="mb-2 mt-1 self-end font-mono text-xs text-[#44504e]">
          {time}
        </span>
        {buttons.map((button, index) => {
          const Icon = ICONS[button.kind];
          return (
            <span
              key={`${button.label}-${index}`}
              className="flex min-h-[38px] items-center justify-center gap-1.5 border-t border-[#dce9e1] text-[13px] font-semibold text-[#087d0a]"
            >
              <Icon size={14} aria-hidden /> {button.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
