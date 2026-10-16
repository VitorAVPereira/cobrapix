"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import styles from "./landing.module.css";

export interface FaqItem {
  question: string;
  answer: string;
}

export function LandingFaq({ items }: { items: FaqItem[] }) {
  // Items open independently; the first answer starts visible.
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const baseId = useId();

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className={styles.faqList}>
      {items.map((item, index) => {
        const isOpen = open.has(index);
        const buttonId = `${baseId}-q${index}`;
        const panelId = `${baseId}-a${index}`;
        return (
          <div key={item.question} className={styles.faqItem} data-open={isOpen}>
            <h3 className={styles.faqHeading}>
              <button
                id={buttonId}
                type="button"
                className={styles.faqButton}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(index)}
              >
                <span>{item.question}</span>
                <span className={styles.faqIcon} aria-hidden>
                  <Plus size={16} strokeWidth={2.5} />
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              className={styles.faqPanel}
            >
              <div className={styles.faqPanelInner}>
                <p>{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
