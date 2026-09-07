import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CircleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { LanguageSwitch, useLocale } from "../i18n.jsx";
import { splitLocalePath } from "../locale-paths.js";
import { useWorkspaceContext } from "../WorkspaceContext.jsx";

function useDestinations() {
  const { t } = useLocale();
  return [
    { href: "/skills", label: t("Catalog", "Каталог"), section: "/skills" },
    {
      href: "/collections",
      label: t("Collections", "Коллекции"),
      section: "/collections",
    },
    { href: "/journal", label: t("Journal", "Журнал"), section: "/journal" },
  ];
}

function WorkspaceMenu() {
  const { t, link } = useLocale();
  const { workspace, ready } = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  const trigger = useRef(null);
  const id = useId();
  const name =
    workspace.profile.name === "Your workspace"
      ? t("My workspace", "Мой кабинет")
      : workspace.profile.name;

  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      className="workspace-disclosure"
      ref={wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="account-header-link"
        type="button"
        ref={trigger}
        aria-label={t("Workspace menu", "Меню кабинета")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <UserCircleIcon size={30} weight="thin" aria-hidden="true" />
        <span>{name}</span>
        <CaretDownIcon size={13} aria-hidden="true" />
      </button>
      <div id={id} className="workspace-menu" hidden={!open}>
        <p className="workspace-menu-label">{t("Your radar", "Ваш радар")}</p>
        <a href={link("/account")}>
          {t("My workspace", "Мой кабинет")}
          <ArrowUpRightIcon size={16} aria-hidden="true" />
        </a>
        <a href={link("/account?tab=saved")}>
          {t("Saved signals", "Сохранённые скиллы")}
          <span className="saved-count">
            {ready ? workspace.savedIds.length : "—"}
          </span>
        </a>
        <a href={link("/account?tab=settings")}>{t("Settings", "Настройки")}</a>
        <a href={link("/login")}>{t("Sign in", "Войти")}</a>
        <p className="workspace-menu-note">
          {t(
            "Workspace saved in this browser. Account sync is not available yet.",
            "Кабинет хранится в этом браузере. Синхронизация аккаунта пока недоступна.",
          )}
        </p>
      </div>
    </div>
  );
}

export function SiteHeader({ layout = "centered" }) {
  const { path, t, link } = useLocale();
  const { path: pathname } = splitLocalePath(path);
  const destinations = useDestinations();
  return (
    <>
      <a href="#main" className="skip-link">
        {t("Skip to content", "Перейти к содержимому")}
      </a>
      <header
        className={`${layout === "editorial" ? "editorial-header unified-header--editorial" : "site-header"} unified-header`}
      >
        <a
          className="wordmark"
          href={link("/")}
          aria-label={t("Reporadars home", "Главная Reporadars")}
        >
          reporadars
        </a>
        <nav
          className="unified-primary-nav"
          aria-label={t("Main navigation", "Главная навигация")}
        >
          {destinations.map((item, index) => (
            <a
              key={item.href}
              href={link(item.href)}
              className={index === 0 ? "nav-signals" : undefined}
              aria-current={
                pathname === item.section
                  ? "page"
                  : item.section && pathname?.startsWith(`${item.section}/`)
                    ? "location"
                    : undefined
              }
            >
              {index === 0 && (
                <CircleIcon size={10} weight="fill" aria-hidden="true" />
              )}
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <WorkspaceMenu />
          <LanguageSwitch />
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  const { t, link } = useLocale();
  const destinations = useDestinations();
  return (
    <footer className="unified-footer">
      <div className="footer-signature">
        <span>
          Reporadars <i aria-hidden="true" />
        </span>
        <p>
          {t(
            "Draft instructions, openly attributed.",
            "Черновые инструкции с открытыми источниками.",
          )}
        </p>
      </div>
      <nav aria-label={t("Footer navigation", "Навигация в подвале")}>
        {destinations.map((item) => (
          <a key={item.href} href={link(item.href)}>
            {item.label}
          </a>
        ))}
        <a href={link("/account?tab=saved")}>
          {t("Saved signals", "Сохранённые скиллы")}
        </a>
      </nav>
      <a
        className="footer-top"
        href="#main"
        aria-label={t("Back to top", "Наверх")}
      >
        <ArrowUpRightIcon size={23} weight="thin" aria-hidden="true" />
      </a>
    </footer>
  );
}
