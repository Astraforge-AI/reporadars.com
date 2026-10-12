import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader, SiteFooter } from "../components/SiteChrome.jsx";
import { useLocale } from "../i18n.jsx";
import { IntakePanel } from "./IntakePanel.jsx";
import { adminClient, AdminApiError } from "./client.js";

const emptyRecord = () => ({
  kind: "skill",
  slug: "",
  title: { en: "", ru: "" },
  summary: { en: "", ru: "" },
  body: { en: "", ru: "" },
  sourceUrl: "",
  category: "research",
  skillIds: [],
  status: "draft",
  revision: null,
});
const translations = {
  en: {
    locale: "en",
    kind: "Kind",
    slug: "Slug",
    languages: "Languages",
    languageNote: "EN / RU fields are saved together",
    summaryEn: "English summary",
    summaryRu: "Russian summary",
    bodyEn: "English body",
    bodyRu: "Russian body",
    saveFirst: "Save the draft before changing publication status.",
    collectionSkills: "Skills in collection",
    collectionLimit:
      "Only the first 100 skills are shown. Existing selections outside this list are preserved.",
    view: "View",
    noUsers: "No users found.",
    noEntries: "No entries.",
    note: "Note",
    moderationNote: "Moderation note",
    accept: "Accept",
    reject: "Reject",
    navigation: "Admin navigation",
    pending: "Pending",
    active: "Active",
    revoked: "Revoked",
    accepted: "Accepted",
    rejected: "Rejected",
    admin: "Administrator",
    user: "User",
    kinds: { skill: "Skill", collection: "Collection", article: "Article" },
    categories: {
      general: "General",
      research: "Research",
      build: "Build",
      review: "Review",
      operate: "Operate",
      protect: "Protect",
      "new-signal": "New signal",
      release: "Release",
      retired: "Retired",
    },
    desk: "Editorial desk",
    required: "Admin access required",
    denied: "Your account is not approved for the editorial desk.",
    signIn: "Sign in",
    retry: "Try again",
    boundary: "Published skills appear in the catalog immediately.",
    overview: "Overview",
    content: "Content",
    users: "Users",
    moderation: "Moderation",
    audit: "Audit",
    newRecord: "New record",
    search: "Search content",
    all: "All statuses",
    draft: "Draft",
    published: "Published",
    archived: "Archived",
    next: "Next page",
    previous: "Previous page",
    save: "Save draft",
    conflict:
      "This record changed on the server. Reload it before retrying; your unsaved edits are still here.",
    unavailable: "The editorial service is unavailable.",
    edit: "Edit",
    create: "Create record",
    title: "English title",
    russianTitle: "Russian title",
    source: "Source URL",
    category: "Category",
    status: "Status",
    publish: "Publish",
    archive: "Archive",
    restore: "Move to draft",
    cancel: "Cancel",
    noRecords: "No records match these filters.",
    page: "Page",
    complete:
      "Add English and Russian title, summary, body, and a source before publishing.",
    loading: "Checking editorial access…",
    signOut: "Sign out",
    signOutFailed:
      "Could not sign out. Your editorial session is still active.",
    staging: "private staging",
    metrics: {
      skills: "Skills",
      collections: "Collections",
      articles: "Articles",
      submissionsPending: "Submissions pending",
      users: "Users",
      published: "Published",
    },
  },
  ru: {
    locale: "ru",
    kind: "Тип записи",
    slug: "Идентификатор URL",
    languages: "Языки",
    languageNote: "Поля EN и RU сохраняются вместе",
    summaryEn: "Английская аннотация",
    summaryRu: "Русская аннотация",
    bodyEn: "Английский текст",
    bodyRu: "Русский текст",
    saveFirst: "Сохраните черновик перед изменением статуса публикации.",
    collectionSkills: "Скиллы в коллекции",
    collectionLimit:
      "Показаны только первые 100 скиллов. Ранее выбранные скиллы вне этого списка сохраняются.",
    view: "Просмотреть",
    noUsers: "Пользователи не найдены.",
    noEntries: "Нет записей.",
    note: "Заметка",
    moderationNote: "Заметка модератора",
    accept: "Принять",
    reject: "Отклонить",
    navigation: "Навигация админ-панели",
    pending: "Ожидает подтверждения",
    active: "Активен",
    revoked: "Доступ отозван",
    accepted: "Принято",
    rejected: "Отклонено",
    admin: "Администратор",
    user: "Пользователь",
    kinds: { skill: "Скилл", collection: "Коллекция", article: "Статья" },
    categories: {
      general: "Общее",
      research: "Исследование",
      build: "Разработка",
      review: "Проверка",
      operate: "Эксплуатация",
      protect: "Защита",
      "new-signal": "Новый скилл",
      release: "Релиз",
      retired: "Снято с публикации",
    },
    desk: "Редакционный стол",
    required: "Нужен доступ администратора",
    denied: "Ваш аккаунт не одобрен для редакционного стола.",
    signIn: "Войти",
    retry: "Повторить",
    boundary: "Опубликованные скиллы сразу появляются в каталоге.",
    overview: "Обзор",
    content: "Контент",
    users: "Пользователи",
    moderation: "Модерация",
    audit: "Аудит",
    newRecord: "Новая запись",
    search: "Поиск контента",
    all: "Все статусы",
    draft: "Черновик",
    published: "Опубликовано",
    archived: "Архив",
    next: "Следующая страница",
    previous: "Предыдущая страница",
    save: "Сохранить черновик",
    conflict:
      "Запись изменилась на сервере. Загрузите её перед повторной попыткой; несохранённые правки остались здесь.",
    unavailable: "Редакционный сервис недоступен.",
    edit: "Редактировать",
    create: "Создать запись",
    title: "Английский заголовок",
    russianTitle: "Русский заголовок",
    source: "URL источника",
    category: "Категория",
    status: "Статус",
    publish: "Опубликовать",
    archive: "Архивировать",
    restore: "Вернуть в черновики",
    cancel: "Отмена",
    noRecords: "Нет записей по этим фильтрам.",
    page: "Страница",
    complete:
      "Для публикации добавьте заголовок, аннотацию, текст на английском и русском и источник.",
    loading: "Проверяем редакционный доступ…",
    signOut: "Выйти",
    signOutFailed: "Не удалось выйти. Редакционная сессия остаётся активной.",
    staging: "закрытая тестовая среда",
    metrics: {
      skills: "Скиллы",
      collections: "Коллекции",
      articles: "Статьи",
      submissionsPending: "Ожидают модерации",
      users: "Пользователи",
      published: "Опубликовано",
    },
  },
};

function errorText(error, copy) {
  if (error instanceof AdminApiError && error.status === 401)
    return copy.required;
  if (error instanceof AdminApiError && error.status === 403)
    return copy.denied;
  return copy.unavailable;
}

function complete(record) {
  return (
    ["en", "ru"].every(
      (language) =>
        record.title?.[language]?.trim() &&
        record.summary?.[language]?.trim() &&
        record.body?.[language]?.trim(),
    ) &&
    (record.kind === "collection" || record.sourceUrl?.trim())
  );
}

function Gate({ children, busy = false }) {
  return (
    <div className="page-shell admin-shell">
      <SiteHeader />
      <main id="main" className="admin-gate" aria-busy={busy}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function RecordForm({ initial, onCancel, onSaved, copy }) {
  const [record, setRecord] = useState(initial);
  const [skills, setSkills] = useState([]);
  const [skillTotal, setSkillTotal] = useState(0);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (record.kind !== "collection") return;
    adminClient
      .records({ kind: "skill", status: "", page: 1, pageSize: 100 })
      .then((result) => {
        setSkills(result.items);
        setSkillTotal(result.total);
      })
      .catch(() => setSkills([]));
  }, [record.kind]);
  const setField = (field, value, language) =>
    setRecord((current) =>
      language
        ? { ...current, [field]: { ...current[field], [language]: value } }
        : { ...current, [field]: value },
    );
  const dirty =
    JSON.stringify([
      record.title,
      record.summary,
      record.body,
      record.sourceUrl,
      record.category,
      record.skillIds,
    ]) !==
    JSON.stringify([
      initial.title,
      initial.summary,
      initial.body,
      initial.sourceUrl,
      initial.category,
      initial.skillIds,
    ]);
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    const body = {
      title: record.title,
      summary: record.summary,
      body: record.body,
      sourceUrl: record.sourceUrl,
      category: record.category,
      skillIds: record.skillIds,
    };
    try {
      const result = record.id
        ? await adminClient.updateRecord(record.id, {
            revision: record.revision,
            ...body,
          })
        : await adminClient.createRecord({
            kind: record.kind,
            slug: record.slug,
            ...body,
          });
      onSaved(result.item);
    } catch (error) {
      setNotice(
        error.code === "CONFLICT" || error.code === "STATE_CONFLICT"
          ? copy.conflict
          : errorText(error, copy),
      );
    } finally {
      setSaving(false);
    }
  };
  const transition = async (status) => {
    if (dirty) {
      setNotice(copy.saveFirst);
      return;
    }
    if (!record.id || (status === "published" && !complete(record))) {
      setNotice(copy.complete);
      return;
    }
    if (!window.confirm(`${copy.status}: ${copy[status]}?`)) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await adminClient.setRecordStatus(record.id, {
        revision: record.revision,
        status,
      });
      onSaved(result.item);
    } catch (error) {
      setNotice(
        error.code === "CONFLICT" || error.code === "STATE_CONFLICT"
          ? copy.conflict
          : errorText(error, copy),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="admin-editor" onSubmit={save}>
      <div className="admin-editor-heading">
        <h2>
          {record.id
            ? record.title[copy.locale] || record.title.en || copy.edit
            : copy.create}
        </h2>
        <button type="button" className="admin-link" onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
      {notice && (
        <p role="alert" className="admin-alert">
          {notice}
        </p>
      )}
      {dirty && record.id && (
        <p className="admin-alert" role="status">
          {copy.saveFirst}
        </p>
      )}
      {!record.id && (
        <div className="admin-fields admin-fields--two">
          <label>
            {copy.kind}
            <select
              aria-label={copy.kind}
              value={record.kind}
              onChange={(event) =>
                setRecord((value) => ({
                  ...value,
                  kind: event.target.value,
                  category:
                    event.target.value === "collection"
                      ? "general"
                      : event.target.value === "article"
                        ? "new-signal"
                        : "research",
                  skillIds: [],
                }))
              }
            >
              <option value="skill">{copy.kinds.skill}</option>
              <option value="collection">{copy.kinds.collection}</option>
              <option value="article">{copy.kinds.article}</option>
            </select>
          </label>
          <label>
            {copy.slug}
            <input
              aria-label={copy.slug}
              required
              pattern="[a-z0-9-]+"
              maxLength="80"
              value={record.slug}
              onChange={(event) => setField("slug", event.target.value)}
            />
          </label>
        </div>
      )}
      <fieldset className="admin-language-tabs">
        <legend>{copy.languages}</legend>
        <span>{copy.languageNote}</span>
      </fieldset>
      <div className="admin-fields admin-fields--two">
        <label>
          {copy.title}
          <input
            aria-label={copy.title}
            readOnly={record.status !== "draft"}
            required
            maxLength="160"
            value={record.title.en}
            onChange={(event) => setField("title", event.target.value, "en")}
          />
        </label>
        <label>
          {copy.russianTitle}
          <input
            aria-label={copy.russianTitle}
            readOnly={record.status !== "draft"}
            required
            maxLength="160"
            value={record.title.ru}
            onChange={(event) => setField("title", event.target.value, "ru")}
          />
        </label>
      </div>
      <div className="admin-fields admin-fields--two">
        <label>
          {copy.summaryEn}
          <textarea
            aria-label={copy.summaryEn}
            readOnly={record.status !== "draft"}
            maxLength="600"
            value={record.summary.en}
            onChange={(event) => setField("summary", event.target.value, "en")}
          />
        </label>
        <label>
          {copy.summaryRu}
          <textarea
            aria-label={copy.summaryRu}
            readOnly={record.status !== "draft"}
            maxLength="600"
            value={record.summary.ru}
            onChange={(event) => setField("summary", event.target.value, "ru")}
          />
        </label>
      </div>
      <div className="admin-fields admin-fields--two">
        <label>
          {copy.bodyEn}
          <textarea
            aria-label={copy.bodyEn}
            readOnly={record.status !== "draft"}
            maxLength="12000"
            value={record.body.en}
            onChange={(event) => setField("body", event.target.value, "en")}
          />
        </label>
        <label>
          {copy.bodyRu}
          <textarea
            aria-label={copy.bodyRu}
            readOnly={record.status !== "draft"}
            maxLength="12000"
            value={record.body.ru}
            onChange={(event) => setField("body", event.target.value, "ru")}
          />
        </label>
      </div>
      <div className="admin-fields admin-fields--two">
        <label>
          {copy.source}
          <input
            aria-label={copy.source}
            readOnly={record.status !== "draft"}
            type="url"
            value={record.sourceUrl}
            onChange={(event) => setField("sourceUrl", event.target.value)}
          />
        </label>
        <label>
          {copy.category}
          <select
            aria-label={copy.category}
            disabled={record.status !== "draft"}
            value={record.category}
            onChange={(event) => setField("category", event.target.value)}
          >
            {(record.kind === "collection"
              ? ["general"]
              : record.kind === "article"
                ? ["new-signal", "review", "release", "retired"]
                : ["research", "build", "review", "operate", "protect"]
            ).map((option) => (
              <option key={option} value={option}>
                {copy.categories[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {record.kind === "collection" && (
        <fieldset className="admin-skill-select">
          <legend>{copy.collectionSkills}</legend>
          {skillTotal > skills.length && (
            <p role="status">{copy.collectionLimit}</p>
          )}
          {skills.map((skill) => (
            <label key={skill.id}>
              <input
                type="checkbox"
                checked={record.skillIds.includes(skill.id)}
                disabled={record.status !== "draft"}
                onChange={(event) =>
                  setField(
                    "skillIds",
                    event.target.checked
                      ? [...record.skillIds, skill.id]
                      : record.skillIds.filter((id) => id !== skill.id),
                  )
                }
              />{" "}
              {skill.title[copy.locale] || skill.title.en}
            </label>
          ))}
        </fieldset>
      )}
      <div className="admin-actions">
        {record.status === "draft" && (
          <button disabled={saving} type="submit">
            {copy.save}
          </button>
        )}
        {record.id && (
          <>
            {record.status === "draft" && (
              <button
                disabled={saving || dirty}
                type="button"
                onClick={() => transition("published")}
              >
                {copy.publish}
              </button>
            )}
            {record.status !== "archived" && (
              <button
                disabled={saving || dirty}
                type="button"
                onClick={() => transition("archived")}
              >
                {copy.archive}
              </button>
            )}
            {record.status !== "draft" && (
              <button
                disabled={saving || dirty}
                type="button"
                onClick={() => transition("draft")}
              >
                {copy.restore}
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}

export function AdminPage() {
  const { locale, link } = useLocale();
  const copy = translations[locale];
  const [gate, setGate] = useState("loading"),
    [active, setActive] = useState("overview"),
    [overview, setOverview] = useState(null),
    [records, setRecords] = useState([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [kind, setKind] = useState("skill"),
    [editing, setEditing] = useState(null),
    [sideData, setSideData] = useState([]),
    [user, setUser] = useState(null),
    [message, setMessage] = useState("");
  const loadSession = async () => {
    setGate("loading");
    try {
      const session = await adminClient.session();
      setUser(session.user);
      setGate("ready");
    } catch (error) {
      setGate(
        error.status === 401
          ? "anonymous"
          : error.status === 403
            ? "forbidden"
            : "unavailable",
      );
    }
  };
  useEffect(() => {
    loadSession();
  }, []);
  useEffect(() => {
    if (gate !== "ready") return;
    if (active === "intake") return;
    let current = true;
    setMessage("");
    setTotal(0);
    setRecords([]);
    setSideData([]);
    if (active === "overview") setOverview(null);
    const request =
      active === "overview"
        ? adminClient.overview()
        : active === "content"
          ? adminClient.records({ kind, status, q: query, page, pageSize: 20 })
          : active === "users"
            ? adminClient.users({ page, pageSize: 20, q: query })
            : active === "moderation"
              ? adminClient.submissions({ status, page, pageSize: 20 })
              : adminClient.audit({ page, pageSize: 20 });
    request
      .then((result) => {
        if (!current) return;
        if (active === "overview") setOverview(result);
        else {
          if (active === "content") setRecords(result.items);
          else setSideData(result.items);
          setTotal(result.total);
        }
      })
      .catch((error) => {
        if (current) setMessage(errorText(error, copy));
      });
    return () => {
      current = false;
    };
  }, [gate, active, kind, page, query, status, locale]);
  const nav = useMemo(
    () => [
      ["overview", copy.overview],
      ["content", copy.content],
      ["users", copy.users],
      ["moderation", copy.moderation],
      ["audit", copy.audit],
      ["intake", locale === "ru" ? "Импорт GitHub" : "GitHub imports"],
    ],
    [copy, locale],
  );
  if (gate === "loading")
    return (
      <Gate busy>
        <h1>{copy.desk}</h1>
        <p>{copy.loading}</p>
      </Gate>
    );
  if (gate !== "ready")
    return (
      <Gate>
        <h1>{gate === "unavailable" ? copy.unavailable : copy.required}</h1>
        <p>{gate === "forbidden" ? copy.denied : ""}</p>
        {gate !== "unavailable" && <a href={link("/login")}>{copy.signIn}</a>}
        {gate === "unavailable" && (
          <button onClick={loadSession}>{copy.retry}</button>
        )}
      </Gate>
    );
  return (
    <div className="page-shell admin-shell">
      <SiteHeader />
      <main id="main" className="admin-main">
        <aside className="admin-sidebar">
          <p className="admin-kicker">Reporadars / admin</p>
          <p className="admin-identity">
            {user?.email}
            <button
              className="admin-link"
              onClick={async () => {
                try {
                  await adminClient.signOut();
                  setUser(null);
                  setGate("anonymous");
                } catch {
                  setMessage(copy.signOutFailed);
                }
              }}
            >
              {copy.signOut}
            </button>
          </p>
          <nav aria-label={copy.navigation}>
            {nav.map(([id, label]) => (
              <a
                href={`#${id}`}
                key={id}
                aria-current={active === id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  if (active === id) return;
                  setActive(id);
                  setEditing(null);
                  setPage(1);
                  setStatus("");
                  setQuery("");
                  setRecords([]);
                  setSideData([]);
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>
        <section className="admin-content">
          <header className="admin-title">
            <div>
              <p className="admin-kicker">
                {copy.status}: {copy.staging}
              </p>
              <h1>{copy.desk}</h1>
            </div>
            <button
              onClick={() => {
                setActive("content");
                setEditing(emptyRecord());
              }}
            >
              {copy.newRecord}
            </button>
          </header>
          <p className="admin-boundary" role="status">
            {copy.boundary}
          </p>
          {message && (
            <p className="admin-alert" role="alert">
              {message}
            </p>
          )}
          {active === "intake" && <IntakePanel />}
          {active === "overview" && (
            <Overview overview={overview} copy={copy} />
          )}
          {active === "content" &&
            (editing ? (
              <RecordForm
                key={`${editing.id || editing.kind}-${editing.revision || 0}`}
                initial={editing}
                copy={copy}
                onCancel={() => setEditing(null)}
                onSaved={(item) => {
                  setEditing(item);
                  setMessage("");
                  setRecords((current) =>
                    current.some((record) => record.id === item.id)
                      ? current.map((record) =>
                          record.id === item.id ? item : record,
                        )
                      : [item, ...current],
                  );
                }}
              />
            ) : (
              <Content
                records={records}
                total={total}
                page={page}
                query={query}
                status={status}
                kind={kind}
                copy={copy}
                onQuery={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
                onKind={(value) => {
                  setKind(value);
                  setPage(1);
                }}
                onStatus={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                onPage={setPage}
                onEdit={setEditing}
              />
            ))}
          {["users", "moderation", "audit"].includes(active) && (
            <AdminList
              active={active}
              items={sideData}
              copy={copy}
              page={page}
              total={total}
              onPage={setPage}
              onUpdate={async (item, nextStatus, note) => {
                try {
                  const result = await adminClient.updateSubmission(item.id, {
                    revision: item.revision,
                    status: nextStatus,
                    note,
                  });
                  setSideData((items) =>
                    items.map((value) =>
                      value.id === item.id ? result.item : value,
                    ),
                  );
                } catch (error) {
                  setMessage(errorText(error, copy));
                }
              }}
            />
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Overview({ overview, copy }) {
  return (
    <section className="admin-section">
      <h2>{copy.overview}</h2>
      {!overview ? (
        <p aria-busy="true">{copy.loading}</p>
      ) : (
        <div className="admin-metrics">
          {Object.entries(overview.counts).map(([name, value]) => (
            <dl key={name}>
              <dt>{copy.metrics[name] || name}</dt>
              <dd>{value}</dd>
            </dl>
          ))}
        </div>
      )}
    </section>
  );
}
function Content({
  records,
  total,
  page,
  query,
  status,
  kind,
  copy,
  onQuery,
  onKind,
  onStatus,
  onPage,
  onEdit,
}) {
  return (
    <section className="admin-section">
      <div className="admin-toolbar">
        <label>
          {copy.search}
          <input
            aria-label={copy.search}
            value={query}
            maxLength="100"
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <label>
          {copy.kind}
          <select
            aria-label={copy.kind}
            value={kind}
            onChange={(event) => onKind(event.target.value)}
          >
            <option value="skill">{copy.kinds.skill}</option>
            <option value="collection">{copy.kinds.collection}</option>
            <option value="article">{copy.kinds.article}</option>
          </select>
        </label>
        <label>
          {copy.status}
          <select
            aria-label={copy.status}
            value={status}
            onChange={(event) => onStatus(event.target.value)}
          >
            <option value="">{copy.all}</option>
            <option value="draft">{copy.draft}</option>
            <option value="published">{copy.published}</option>
            <option value="archived">{copy.archived}</option>
          </select>
        </label>
      </div>
      <div className="admin-table" role="table">
        {records.length ? (
          records.map((record) => (
            <div role="row" key={record.id}>
              <span role="cell">
                <strong>{record.title[copy.locale] || record.title.en}</strong>
                <small>
                  {copy.kinds[record.kind]} · {record.slug}
                </small>
              </span>
              <span role="cell">{copy[record.status]}</span>
              <button
                aria-label={`${copy.edit} ${record.title[copy.locale] || record.title.en}`}
                onClick={() => onEdit(record)}
              >
                {record.status === "draft" ? copy.edit : copy.view}
              </button>
            </div>
          ))
        ) : (
          <p>{copy.noRecords}</p>
        )}
      </div>
      <div className="admin-pagination">
        <button
          aria-label={copy.previous}
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          {copy.previous}
        </button>
        <span>
          {copy.page} {page}
        </span>
        <button
          aria-label={copy.next}
          disabled={page * 20 >= total}
          onClick={() => onPage(page + 1)}
        >
          {copy.next}
        </button>
      </div>
    </section>
  );
}
function AdminList({ active, items, copy, page, total, onPage, onUpdate }) {
  return (
    <section className="admin-section">
      <h2>{copy[active]}</h2>
      <div className="admin-table" role="table">
        {items.length ? (
          items.map((item) => (
            <AdminRow
              key={item.id}
              item={item}
              copy={copy}
              active={active}
              onUpdate={onUpdate}
            />
          ))
        ) : (
          <p>{active === "users" ? copy.noUsers : copy.noEntries}</p>
        )}
      </div>
      <div className="admin-pagination">
        <button
          aria-label={copy.previous}
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          {copy.previous}
        </button>
        <span>
          {copy.page} {page}
        </span>
        <button
          aria-label={copy.next}
          disabled={page * 20 >= total}
          onClick={() => onPage(page + 1)}
        >
          {copy.next}
        </button>
      </div>
    </section>
  );
}
function AdminRow({ item, active, onUpdate, copy }) {
  const note = useRef(item.note || "");
  if (active === "users")
    return (
      <div role="row">
        <span role="cell">
          <strong>{item.email}</strong>
          <small>{item.name || item.id}</small>
        </span>
        <span role="cell">
          {copy[item.role] || item.role} / {copy[item.adminState] || "—"}
        </span>
      </div>
    );
  if (active === "audit")
    return (
      <div role="row">
        <span role="cell">
          <strong>{item.action}</strong>
          <small>
            {item.entityType} · {item.entityId}
          </small>
        </span>
        <span role="cell">r{item.revision}</span>
      </div>
    );
  return (
    <div role="row">
      <span role="cell">
        <strong>{item.title}</strong>
        <small>{item.sourceUrl}</small>
      </span>
      <label>
        {copy.note}
        <input
          aria-label={copy.moderationNote}
          defaultValue={item.note || ""}
          maxLength="2000"
          onInput={(event) => {
            note.current = event.target.value;
          }}
        />
      </label>
      <span>
        <button onClick={() => onUpdate(item, "accepted", note.current)}>
          {copy.accept}
        </button>
        <button onClick={() => onUpdate(item, "rejected", note.current)}>
          {copy.reject}
        </button>
      </span>
    </div>
  );
}
