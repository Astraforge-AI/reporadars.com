import Head from "next/head";
import { App } from "./App.jsx";
import { resolvePage } from "./data/skills.js";
import { buildCatalog } from "./data/live-catalog.js";
import { buildEditorialContent } from "./data/live-editorial.js";
import { localeHref, splitLocalePath } from "./locale-paths.js";

export default function Page({ path, catalog = null }) {
  const { locale } = splitLocalePath(path);
  const ru = locale === "ru";
  const localized = buildCatalog(locale, catalog);
  const page = resolvePage(
    path,
    localized,
    buildEditorialContent(catalog).articles,
  );
  const skill =
    page.skill && localized.find((item) => item.id === page.skill.id);
  const titles = {
    home: ru ? "Скиллы для ИИ-агентов" : "Skills for AI agents",
    library: ru ? "Каталог скиллов" : "Skills catalog",
    collections: ru ? "Коллекции скиллов" : "Skill collections",
    account: ru ? "Мой кабинет" : "My workspace",
    admin: ru ? "Админ-панель" : "Admin",
    login: ru ? "Вход" : "Sign in",
    journal: ru ? "Журнал" : "Journal",
    "not-found": ru ? "Страница не найдена" : "Page not found",
  };
  const title = `${skill?.title || page.article?.title[locale] || titles[page.type]} — Reporadars`;
  const description =
    skill?.summary ||
    page.article?.summary[locale] ||
    (ru
      ? "Найдите скилл для своей задачи, изучите инструкции и сохраните его в кабинете."
      : "Find a skill for your task, read its instructions and save it to your workspace.");
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={`https://reporadars.com${path}`} />
        <link rel="canonical" href={`https://reporadars.com${path}`} />
        {["en", "ru", "x-default"].map((lang) => (
          <link
            key={lang}
            rel="alternate"
            hrefLang={lang}
            href={`https://reporadars.com${localeHref(path, lang === "ru" ? "ru" : "en")}`}
          />
        ))}
        {(["account", "admin", "login", "not-found"].includes(page.type) ||
          (page.type === "article" && page.article.sample) ||
          (page.type === "journal" && !catalog?.articles?.length)) && (
          <meta name="robots" content="noindex, nofollow" />
        )}
      </Head>
      <App path={path} catalog={catalog} />
    </>
  );
}
