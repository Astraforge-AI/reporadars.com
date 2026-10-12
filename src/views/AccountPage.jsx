import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  BookmarkSimpleIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  CircleIcon,
  FloppyDiskIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import {
  CommandBlock,
  PageFooter,
  RadarArtwork,
  SkillIcon,
} from "../components/CatalogUI.jsx";
import { useLocale } from "../i18n.jsx";

const defaultProfile = {
  name: "Your workspace",
  role: "Skill curator",
  bio: "Curating reliable tools for developers and agents.",
};

export function AccountPage({
  skills,
  workspace,
  ready,
  storageError,
  saveProfile,
  toggleSaved,
  reset,
}) {
  const { t, link, locale } = useLocale();
  const tabs = [
    ["profile", t("Profile", "Профиль")],
    ["saved", t("Saved signals", "Сохранённые сигналы")],
    ["published", t("Published", "Опубликованные")],
    ["settings", t("Settings", "Настройки")],
  ];
  const [tab, setTab] = useState("profile");
  const [draft, setDraft] = useState(workspace.profile);
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => setDraft(workspace.profile), [workspace.profile]);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (tabs.some(([id]) => id === value)) setTab(value);
  }, []);
  function changeTab(value) {
    setTab(value);
    setNotice("");
    setConfirmReset(false);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    history.replaceState(
      null,
      "",
      link(url.pathname.replace(/^\/ru(?=\/|$)/, "")) + url.search + url.hash,
    );
    window.dispatchEvent(new Event("reporadars:navigation"));
  }
  const saved = workspace.savedIds
    .map((id) => skills.find((skill) => skill.id === id))
    .filter(Boolean);
  const visible = tab === "saved" ? saved : saved.slice(0, 5);
  const unavailable = workspace.savedIds.filter(
    (id) => !saved.some((skill) => skill.id === id),
  );
  const profile = workspace.profile;
  const localizedProfile = {
    name:
      profile.name === defaultProfile.name
        ? t(defaultProfile.name, "Ваш кабинет")
        : profile.name,
    role:
      profile.role === defaultProfile.role
        ? t(defaultProfile.role, "Куратор скиллов")
        : profile.role,
    bio:
      profile.bio === defaultProfile.bio
        ? t(
            defaultProfile.bio,
            "Собираем надёжные инструменты для разработчиков и агентов.",
          )
        : profile.bio,
  };
  const storageMessage = (value) =>
    locale !== "ru"
      ? value
      : {
          "Browser storage is unavailable or unreadable. Changes will last only for this visit.":
            "Хранилище браузера недоступно или не читается. Изменения сохранятся только на этот сеанс.",
          "Browser storage is unavailable. Changes will last only for this visit.":
            "Хранилище браузера недоступно. Изменения сохранятся только на этот сеанс.",
          "Could not save to this browser. Changes will last only for this visit.":
            "Не удалось сохранить данные в браузере. Изменения сохранятся только на этот сеанс.",
          "Could not read the updated workspace from another tab.":
            "Не удалось прочитать обновлённое рабочее пространство из другой вкладки.",
        }[value] || value;
  return (
    <>
      <main id="main" className="account-page rr-page">
        <section className="account-hero" aria-labelledby="account-name">
          <RadarArtwork className="account-art" />
          <div className="account-identity">
            <img
              className="account-portrait"
              src={
                profile.avatar === "portrait"
                  ? "/reporadars-assets/curator-portrait.webp"
                  : "/reporadars-assets/radar-crosshair.webp"
              }
              width="212"
              height="218"
              alt={
                profile.avatar === "portrait"
                  ? t(
                      "Selected example curator portrait",
                      "Выбран пример портрета куратора",
                    )
                  : t(
                      "Radar artwork chosen for this workspace",
                      "Для этого рабочего пространства выбрана иллюстрация радара",
                    )
              }
            />
            <div className="account-bio">
              <h1 id="account-name">
                {localizedProfile.name}
                <span className="account-period">.</span>
              </h1>
              <p className="account-role">{localizedProfile.role}</p>
              <p className="account-description">{localizedProfile.bio}</p>
              <div className="account-badges">
                <span>
                  <UserCircleIcon weight="thin" size={26} />{" "}
                  {t("Local workspace", "Локальное рабочее пространство")}
                </span>
                <span>
                  <BookmarkSimpleIcon weight="thin" size={25} />{" "}
                  {workspace.savedIds.length}{" "}
                  {t("saved signals", "сохранённых сигналов")}
                </span>
                <span>
                  <CalendarBlankIcon weight="thin" size={25} />{" "}
                  {t("This browser only", "Только этот браузер")}
                </span>
              </div>
              <p className="account-local-note">
                {t(
                  "No sign-in or cloud sync. Your profile and saved signals stay on this device.",
                  "Нет входа или облачной синхронизации. Ваш профиль и сохранённые сигналы остаются на этом устройстве.",
                )}
              </p>
            </div>
          </div>
          <div
            className="account-tabs"
            role="tablist"
            aria-label={t(
              "Workspace sections",
              "Разделы рабочего пространства",
            )}
          >
            {tabs.map(([id, label], index) => (
              <button
                key={id}
                id={`account-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls="account-panel"
                tabIndex={tab === id ? 0 : -1}
                onClick={() => changeTab(id)}
                onKeyDown={(event) => {
                  let next;
                  if (event.key === "ArrowRight")
                    next = (index + 1) % tabs.length;
                  if (event.key === "ArrowLeft")
                    next = (index + tabs.length - 1) % tabs.length;
                  if (event.key === "Home") next = 0;
                  if (event.key === "End") next = tabs.length - 1;
                  if (next !== undefined) {
                    event.preventDefault();
                    changeTab(tabs[next][0]);
                    document
                      .getElementById(`account-tab-${tabs[next][0]}`)
                      ?.focus();
                  }
                }}
              >
                {label}
                {tab === id && (
                  <CircleIcon size={7} weight="fill" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </section>
        {storageError && (
          <p role="alert" className="account-warning">
            {storageMessage(storageError)}
          </p>
        )}
        <div
          id="account-panel"
          role="tabpanel"
          aria-labelledby={`account-tab-${tab}`}
          className={`account-panel account-panel-${tab}`}
        >
          {(tab === "profile" || tab === "saved") && (
            <section className="account-column" aria-labelledby="saved-title">
              <h2 id="saved-title">
                <BookmarkSimpleIcon weight="thin" size={38} />
                <span>
                  {tab === "saved"
                    ? t("Saved signals", "Сохранённые сигналы")
                    : t("Recently saved skills", "Недавно сохранённые скиллы")}
                  <i>.</i>
                </span>
              </h2>
              {unavailable.length > 0 && (
                <div className="account-storage-note" role="status">
                  <p>
                    {t(
                      "Some saved skills are currently unavailable. Their IDs remain on this device.",
                      "Некоторые сохранённые скиллы сейчас недоступны. Их ID остаются на этом устройстве.",
                    )}
                  </p>
                  {tab === "saved" && (
                    <ul>
                      {unavailable.map((id) => (
                        <li key={id}>
                          {id}{" "}
                          <button type="button" onClick={() => toggleSaved(id)}>
                            {t("Remove", "Удалить")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {visible.length > 0 ? (
                <>
                  <table className="account-table saved-table">
                    <thead>
                      <tr>
                        <th>{t("Skill", "Скилл")}</th>
                        <th>
                          {t("Add command", "Команда добавления")}{" "}
                          <small>{t("CLI preview", "предпросмотр CLI")}</small>
                        </th>
                        <th>{t("Status", "Статус")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((skill) => (
                        <tr key={skill.id}>
                          <td>
                            <div className="account-skill-cell">
                              <a href={link(`/skills/${skill.id}`)}>
                                <span className="account-skill-mark">
                                  <SkillIcon id={skill.id} size={26} />
                                </span>
                                <span>{skill.title}</span>
                              </a>
                              <button
                                className="account-remove"
                                aria-label={t(
                                  `Remove ${skill.title} from saved signals`,
                                  `Удалить ${skill.title} из сохранённых сигналов`,
                                )}
                                disabled={!ready}
                                onClick={() => toggleSaved(skill.id)}
                              >
                                <TrashIcon size={17} />
                              </button>
                            </div>
                          </td>
                          <td>
                            <CommandBlock skill={skill} compact />
                          </td>
                          <td>
                            <span className="account-draft">
                              <CheckCircleIcon size={21} weight="thin" />{" "}
                              {t("Draft", "Черновик")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {tab === "profile" && (
                    <button
                      className="account-view-all"
                      onClick={() => changeTab("saved")}
                    >
                      {t(
                        "View all saved signals",
                        "Показать все сохранённые сигналы",
                      )}{" "}
                      <ArrowRightIcon size={20} weight="thin" />
                    </button>
                  )}
                </>
              ) : (
                <div className="account-empty">
                  <p>
                    {t(
                      "Your next useful signal belongs here.",
                      "Ваш следующий полезный сигнал появится здесь.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Open a skill and select “Save skill” to build your own collection.",
                      "Откройте скилл и выберите «Сохранить скилл», чтобы собрать свою коллекцию.",
                    )}
                  </p>
                  <a href={link("/skills")}>
                    {t("Explore the library", "Открыть библиотеку")}{" "}
                    <ArrowRightIcon size={22} weight="thin" />
                  </a>
                </div>
              )}
            </section>
          )}
          {(tab === "profile" || tab === "published") && (
            <section
              className="account-column"
              aria-labelledby="published-title"
            >
              <h2 id="published-title">
                <ShieldCheckIcon weight="thin" size={38} />
                <span>
                  {t(
                    "Published & reviewed contributions",
                    "Опубликованные и проверенные материалы",
                  )}
                  <i>.</i>
                </span>
              </h2>
              <table className="account-table contributions-table">
                <thead>
                  <tr>
                    <th>{t("Skill", "Скилл")}</th>
                    <th>{t("Review state", "Статус проверки")}</th>
                    <th>{t("Last updated", "Последнее обновление")}</th>
                  </tr>
                </thead>
              </table>
              <div className="account-empty">
                <p>
                  {t(
                    "No published contributions yet.",
                    "Опубликованных материалов пока нет.",
                  )}
                </p>
                <p>
                  {t(
                    "Publishing and community reviews need a connected account. They are not enabled in this local workspace.",
                    "Для публикации и проверок сообществом нужна подключённая учётная запись. В этом локальном рабочем пространстве они недоступны.",
                  )}
                </p>
                <a href={link("/skills")}>
                  {t("Find a skill to explore", "Найти скилл для изучения")}{" "}
                  <ArrowRightIcon size={22} weight="thin" />
                </a>
              </div>
            </section>
          )}
          {tab === "settings" && (
            <section
              className="account-settings"
              aria-labelledby="settings-title"
            >
              <div>
                <h2 id="settings-title">
                  {t("Make it yours", "Настройте под себя")}
                  <span>.</span>
                </h2>
                <p>
                  {t(
                    "Your changes are saved only in this browser. This is not an authenticated account.",
                    "Изменения сохраняются только в этом браузере. Это не аутентифицированная учётная запись.",
                  )}
                </p>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const result = saveProfile(draft);
                  setNotice(
                    result?.error
                      ? t(
                          "Changes are available for this visit only.",
                          "Изменения доступны только в этом сеансе.",
                        )
                      : t(
                          "Profile saved in this browser.",
                          "Профиль сохранён в этом браузере.",
                        ),
                  );
                }}
              >
                <label>
                  {t("Display name", "Отображаемое имя")}
                  <input
                    name="displayName"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    maxLength={40}
                    required
                    disabled={!ready}
                  />
                </label>
                <label>
                  {t("Role", "Роль")}
                  <input
                    name="role"
                    value={draft.role}
                    onChange={(event) =>
                      setDraft({ ...draft, role: event.target.value })
                    }
                    maxLength={50}
                    required
                    disabled={!ready}
                  />
                </label>
                <label>
                  {t("Bio", "О себе")}
                  <textarea
                    name="bio"
                    value={draft.bio}
                    onChange={(event) =>
                      setDraft({ ...draft, bio: event.target.value })
                    }
                    maxLength={180}
                    rows={3}
                    disabled={!ready}
                  />
                </label>
                <fieldset>
                  <legend>
                    {t("Workspace image", "Изображение рабочего пространства")}
                  </legend>
                  <label className="account-avatar-choice">
                    <input
                      type="radio"
                      name="avatar"
                      value="radar"
                      checked={draft.avatar === "radar"}
                      onChange={() => setDraft({ ...draft, avatar: "radar" })}
                    />
                    <img src="/reporadars-assets/radar-crosshair.webp" alt="" />
                    {t("Radar artwork", "Иллюстрация радара")}
                  </label>
                  <label className="account-avatar-choice">
                    <input
                      type="radio"
                      name="avatar"
                      value="portrait"
                      checked={draft.avatar === "portrait"}
                      onChange={() =>
                        setDraft({ ...draft, avatar: "portrait" })
                      }
                    />
                    <img
                      src="/reporadars-assets/curator-portrait.webp"
                      alt=""
                    />
                    {t("Example curator portrait", "Пример портрета куратора")}
                  </label>
                </fieldset>
                <button className="account-save" disabled={!ready}>
                  <FloppyDiskIcon size={20} />{" "}
                  {t("Save changes", "Сохранить изменения")}
                </button>
                <p role="status">{notice}</p>
              </form>
              <div className="account-reset">
                <h3>
                  {t(
                    "Reset this workspace",
                    "Сбросить это рабочее пространство",
                  )}
                </h3>
                <p>
                  {t(
                    "Removes this browser’s profile and saved selections. Other sites and browser data are not affected.",
                    "Удаляет профиль и сохранённые выборки в этом браузере. Другие сайты и данные браузера не затрагиваются.",
                  )}
                </p>
                {confirmReset ? (
                  <div>
                    <button
                      onClick={() => {
                        reset();
                        setNotice(
                          t(
                            "Workspace reset.",
                            "Рабочее пространство сброшено.",
                          ),
                        );
                        setConfirmReset(false);
                      }}
                    >
                      {t("Confirm reset", "Подтвердить сброс")}
                    </button>
                    <button onClick={() => setConfirmReset(false)}>
                      {t("Cancel", "Отмена")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    disabled={!ready}
                  >
                    {t(
                      "Reset local workspace",
                      "Сбросить локальное рабочее пространство",
                    )}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
      <PageFooter />
    </>
  );
}
