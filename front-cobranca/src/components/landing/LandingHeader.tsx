"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LogIn, Menu, X } from "lucide-react";
import { LOGIN_URL } from "./contact";
import styles from "./landing.module.css";

const SECTION_LINKS = [
  { label: "Formas de pagamento", href: "#formas_pagamento" },
  { label: "Como funciona", href: "#como_funciona" },
  { label: "Perguntas", href: "#perguntas" },
];

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <header className={styles.header} data-scrolled={scrolled || menuOpen ? "true" : "false"}>
      <div className={styles.headerInner}>
        <div className={styles.navPill}>
          <a href="#inicio" className={styles.headerLogo} aria-label="CifraMais, início">
            <Image src="/brand/cifra-plus-reverse.svg" alt="" width={87} height={28} priority />
          </a>
          <nav aria-label="Seções da página" className={styles.headerNav}>
            {SECTION_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={styles.navLink}>
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className={styles.headerActions}>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="menu-secoes"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            Menu
          </button>
          <Link href={LOGIN_URL} className={styles.loginButton}>
            <LogIn size={17} aria-hidden />
            Entrar
          </Link>
        </div>
      </div>

      <nav id="menu-secoes" aria-label="Seções da página" className={styles.menuPanel} hidden={!menuOpen}>
        {SECTION_LINKS.map((link) => (
          <a key={link.href} href={link.href} className={styles.menuLink} onClick={closeMenu}>
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
