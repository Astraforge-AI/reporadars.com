import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOutIcon,
  BookOpenIcon,
  BracketsCurlyIcon,
  BrowserIcon,
  CheckCircleIcon,
  CopyIcon,
  DatabaseIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { useLocale } from "../i18n.jsx";
import { SiteFooter } from "./SiteChrome.jsx";

const icons = {
  "seo-audit": MagnifyingGlassIcon,
  "security-review": ShieldCheckIcon,
  "api-contract": BracketsCurlyIcon,
  "browser-testing": BrowserIcon,
  "release-readiness": WrenchIcon,
  "sql-performance": DatabaseIcon,
  "vector-store-hygiene": DatabaseIcon,
  "evaluation-frameworks": BookOpenIcon,
};

export function SkillIcon({ id, size = 24 }) {
  const Icon = icons[id] || GearSixIcon;
  return <Icon size={size} weight="thin" aria-hidden="true" />;
}

export function SourceMark({ skill }) {
  return (
    <a
      className="rr-source"
      href={skill.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="rr-source-mark" aria-hidden="true">
        <BookOpenIcon size={17} weight="thin" />
      </span>
      <span>
        <strong>{skill.source}</strong>
        <small>{skill.sourceLabel}</small>
      </span>
      <ArrowSquareOutIcon size={14} weight="light" aria-hidden="true" />
    </a>
  );
}

export function CommandBlock({ skill, compact = false }) {
  const { t } = useLocale();
  const [state, setState] = useState("idle");
  const timer = useRef();
  const command = `npx reporadars add ${skill.id}`;
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2200);
  }
  const message =
    state === "copied"
      ? t(
          "Command copied — CLI coming soon.",
          "Команда скопирована — CLI появится позже.",
        )
      : state === "failed"
        ? t(
            "Copy unavailable. Select the command to copy.",
            "Копирование недоступно. Выделите команду и скопируйте её.",
          )
        : t(
            "CLI coming soon — preview only.",
            "CLI появится позже — только предварительный просмотр.",
          );
  return (
    <div
      className={`rr-command ${compact ? "rr-command--compact" : ""}`}
      data-copy-state={state}
    >
      <div className="rr-command-shell">
        <TerminalWindowIcon
          size={compact ? 14 : 18}
          weight="light"
          aria-hidden="true"
        />
        <code>{command}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={t(`Copy ${command}`, `Скопировать ${command}`)}
          title={t("Copy command", "Скопировать команду")}
        >
          {state === "copied" ? (
            <CheckCircleIcon size={18} weight="light" aria-hidden="true" />
          ) : (
            <CopyIcon size={18} weight="light" aria-hidden="true" />
          )}
        </button>
      </div>
      <p className="rr-command-note" role="status">
        {message}
      </p>
    </div>
  );
}

export function RadarArtwork({ className = "" }) {
  return (
    <img
      className={`rr-radar ${className}`}
      src="/reporadars-assets/radar-crosshair.webp"
      alt=""
      aria-hidden="true"
    />
  );
}

export function PageFooter() {
  return <SiteFooter />;
}
