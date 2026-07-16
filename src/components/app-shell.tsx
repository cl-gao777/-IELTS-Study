"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./app-shell.module.css";

const navSections = [
  {
    label: "Study",
    items: [
      { href: "/", label: "Today", icon: "⌂" },
      { href: "/coach", label: "女仆小C", icon: "C" },
      { href: "/vocabulary", label: "Vocabulary", icon: "Aa" },
      { href: "/practice", label: "Practice", icon: "✓" },
      { href: "/writing", label: "Writing", icon: "✎" },
    ],
  },
  {
    label: "Exam",
    items: [
      { href: "/mock-exam", label: "Mock exam", icon: "◫" },
      { href: "/review", label: "Review", icon: "↺" },
      { href: "/analytics", label: "Analytics", icon: "↗" },
    ],
  },
  {
    label: "Library",
    items: [
      { href: "/materials", label: "Materials", icon: "≡" },
      { href: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>I</span>
          <span>
            <strong>ISTS</strong>
            <small>IELTS Study OS</small>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary navigation">
          {navSections.map((section) => (
            <div className={styles.navSection} key={section.label}>
              <p>{section.label}</p>
              {section.items.map((item) => {
                const current = isCurrent(pathname, item.href);
                return (
                  <Link
                    className={`${styles.navItem} ${current ? styles.current : ""}`}
                    href={item.href}
                    key={item.href}
                    aria-current={current ? "page" : undefined}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={styles.footer}>
          <div className={styles.localBadge}>
            <i />
            <span>
              <strong>Private workspace</strong>
              <small>SQLite · server-side AI</small>
            </span>
          </div>
          <div className={styles.profile}>
            <span>A</span>
            <div>
              <strong>Aimer</strong>
              <small>Target band 7.0</small>
            </div>
          </div>
        </div>
      </aside>
      <main className={styles.main} id="main-content">
        {children}
      </main>
    </div>
  );
}

