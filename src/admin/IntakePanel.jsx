import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n.jsx";

async function request(path = "", body) {
  const response = await fetch(`/api/admin/intake${path}`, {
    credentials: "same-origin",
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.code || "UNAVAILABLE");
  return payload;
}

export function IntakePanel() {
  const { t } = useLocale();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [repository, setRepository] = useState(""),
    [workflowId, setWorkflowId] = useState(""),
    [allowAuto, setAllowAuto] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [offset, setOffset] = useState(0),
    [sourceOffset, setSourceOffset] = useState(0),
    [detail, setDetail] = useState(null);
  const [intervalHours, setIntervalHours] = useState(24);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: query,
        status,
        offset: String(offset),
        sourceOffset: String(sourceOffset),
      });
      const result = await request(`?${params}`);
      if (current === sequence.current) setData(result);
    } catch (e) {
      if (current === sequence.current) setError(e.message);
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [query, status, offset, sourceOffset]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  async function action(path, body) {
    setBusy(true);
    setError("");
    try {
      await request(path, body);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="intake-panel" aria-labelledby="intake-title">
      <h2 id="intake-title">{t("GitHub imports", "Импорт из GitHub")}</h2>
      <p>
        {t(
          "Collections and ready-made GitHub packages. Review candidates before publication.",
          "Сборники и готовые GitHub-пакеты. Проверьте кандидатов перед публикацией.",
        )}
      </p>
      {error && (
        <p role="alert">
          {error === "RUN_COOLDOWN"
            ? t(
                "Wait 15 minutes before requesting another run.",
                "Повторный запуск доступен через 15 минут после предыдущего запроса.",
              )
            : error === "INTAKE_PAUSED"
              ? t(
                  "Resume import before requesting a run.",
                  "Возобновите импорт перед запуском.",
                )
              : error}
        </p>
      )}
      {loading && <p role="status">{t("Loading…", "Загрузка…")}</p>}
      <button type="button" disabled={busy || loading} onClick={refresh}>
        {t("Refresh", "Обновить")}
      </button>
      {data?.control && (
        <div>
          <p role="status">
            {data.control.paused
              ? t("Import is paused", "Импорт приостановлен")
              : t(
                  "Scheduled import is enabled",
                  "Импорт по расписанию включён",
                )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              action("/control", {
                paused: !data.control.paused,
                intervalHours: data.control.intervalHours,
              })
            }
          >
            {data.control.paused
              ? t("Resume import", "Возобновить импорт")
              : t("Pause import", "Приостановить импорт")}
          </button>
          <button
            type="button"
            disabled={
              busy || data.control.paused || Boolean(data.control.manualRequest)
            }
            onClick={() => action("/run", {})}
          >
            {data.control.manualRequest
              ? t("Run queued", "Запуск в очереди")
              : t("Run a limited import", "Запустить ограниченный импорт")}
          </button>
          <small>
            {t(
              "The queue is checked every minute. Repeated runs are limited to one per 15 minutes.",
              "Очередь проверяется каждую минуту. Повторный запуск доступен раз в 15 минут.",
            )}
          </small>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action("/control", {
                paused: data.control.paused,
                intervalHours,
              });
            }}
          >
            <label>
              {t("Import interval, hours", "Интервал импорта, часы")}
              <input
                type="number"
                min="6"
                max="168"
                step="1"
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value))}
              />
            </label>
            <small>
              {t(
                `Current interval: ${data.control.intervalHours} hours. Changes take effect on the next scheduler check.`,
                `Текущий интервал: ${data.control.intervalHours} ч. Изменения применяются при следующей проверке расписания.`,
              )}
            </small>
            <button type="submit" disabled={busy}>
              {t("Save schedule", "Сохранить расписание")}
            </button>
          </form>
        </div>
      )}
      <p>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {t(
            "I have reviewed the source and confirmed rights to publish metadata.",
            "Я изучил источник и подтвердил права на публикацию метаданных.",
          )}
        </label>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action("/sources", {
            repository,
            allowAuto,
            rightsConfirmed: confirmed,
            workflowId: workflowId ? Number(workflowId) : null,
          });
        }}
      >
        <label>
          {t("Repository URL", "URL репозитория")}
          <input
            type="url"
            required
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
            placeholder="https://github.com/owner/repo"
          />
        </label>
        <label>
          {t(
            "Approved Actions workflow ID (optional)",
            "ID разрешённого workflow Actions (необязательно)",
          )}
          <input
            type="number"
            min="1"
            step="1"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowAuto}
            onChange={(e) => setAllowAuto(e.target.checked)}
          />
          {t("Automatic publication", "Автопубликация")}
        </label>
        <button type="submit" disabled={busy || (allowAuto && !confirmed)}>
          {t("Save source", "Сохранить источник")}
        </button>
      </form>
      {data?.sources.map((source) => (
        <p key={source.repository}>
          <a href={source.repository} target="_blank" rel="noopener noreferrer">
            {source.repository}
          </a>
          {" — "}
          {source.allow_auto
            ? t("Auto enabled", "Автопубликация включена")
            : t("Review required", "Нужна проверка")}
          {source.workflow_id && <small>Actions #{source.workflow_id}</small>}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRepository(source.repository);
              setWorkflowId(String(source.workflow_id || ""));
              setAllowAuto(Boolean(source.allow_auto));
              setConfirmed(false);
            }}
          >
            {t("Edit source", "Изменить источник")}
          </button>
          {Boolean(source.allow_auto) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                action("/sources", {
                  repository: source.repository,
                  allowAuto: false,
                  rightsConfirmed: false,
                })
              }
            >
              {t("Disable", "Отключить")}
            </button>
          )}
        </p>
      ))}
      {data && (
        <nav aria-label={t("Source pages", "Страницы источников")}>
          <button
            type="button"
            disabled={loading || sourceOffset === 0}
            onClick={() => setSourceOffset(Math.max(0, sourceOffset - 25))}
          >
            {t("Previous sources", "Предыдущие источники")}
          </button>
          <span>
            {Math.min(sourceOffset + 1, data.sourceTotal)}–
            {Math.min(sourceOffset + 25, data.sourceTotal)} / {data.sourceTotal}
          </span>
          <button
            type="button"
            disabled={loading || sourceOffset + 25 >= data.sourceTotal}
            onClick={() => setSourceOffset((current) => current + 25)}
          >
            {t("Next sources", "Следующие источники")}
          </button>
        </nav>
      )}
      {data && (
        <p>
          {data.counts
            .map((item) => `${item.status}: ${item.count}`)
            .join(" · ")}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setQuery(search.trim());
        }}
      >
        <label>
          {t("Search candidates", "Поиск кандидатов")}
          <input
            type="search"
            maxLength="200"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          {t("Candidate status", "Статус кандидата")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t("All statuses", "Все статусы")}</option>
            <option value="needs_review">
              {t("Needs review", "На проверке")}
            </option>
            <option value="blocked">{t("Blocked", "Заблокирован")}</option>
            <option value="published">{t("Published", "Опубликован")}</option>
            <option value="rejected">{t("Rejected", "Отклонён")}</option>
          </select>
        </label>
        <button type="submit" disabled={busy || loading}>
          {t("Search", "Найти")}
        </button>
      </form>
      {detail && (
        <aside aria-label={t("Candidate details", "Данные кандидата")}>
          <h3>{detail.candidate.name}</h3>
          <p>
            {detail.commitSha} · {detail.candidate.bundleSha256}
          </p>
          {detail.previous && (
            <p>
              {t("Previously published commit", "Ранее опубликованный commit")}:{" "}
              {detail.previous.commit}
            </p>
          )}
          {detail.changes?.length > 0 && (
            <details open>
              <summary>
                {t(
                  "Changes from the published version",
                  "Изменения относительно опубликованной версии",
                )}
              </summary>
              <dl>
                {detail.changes.map((change) => (
                  <div key={change.field}>
                    <dt>
                      {
                        {
                          name: t("Name", "Название"),
                          description: t("Description", "Описание"),
                          source: t("Source", "Источник"),
                          commit: "Commit",
                          bundle: "SHA-256",
                          path: t("Path", "Путь"),
                        }[change.field]
                      }
                    </dt>
                    <dd>
                      <del>{change.before}</del>
                      <br />
                      <ins>{change.after}</ins>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {detail.conflicts?.length > 0 && (
            <p role="status">
              {t(
                "This bundle already has a published card. Resolve the duplicate before publishing:",
                "Эта сборка уже опубликована. Разберите дубликат перед публикацией:",
              )}{" "}
              {detail.conflicts.map((item) => item.slug).join(", ")}
            </p>
          )}
          <ul>
            {detail.candidate.findings.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                {f.severity}: {f.message || f.code} {f.path}
                {f.line ? `:${f.line}` : ""}
              </li>
            ))}
          </ul>
          <details>
            <summary>
              {t(
                "Original instructions — untrusted content",
                "Исходные инструкции — непроверенный текст",
              )}
            </summary>
            <pre className="intake-instructions">
              {detail.candidate.reviewText ||
                t(
                  "Open the source to inspect instructions.",
                  "Откройте источник для проверки инструкций.",
                )}
            </pre>
          </details>
          <button type="button" onClick={() => setDetail(null)}>
            {t("Close details", "Закрыть данные")}
          </button>
        </aside>
      )}
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("Skill", "Скилл")}</th>
              <th>{t("Source", "Источник")}</th>
              <th>{t("Status", "Статус")}</th>
              <th>{t("Review", "Проверка")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setDetail(await request(`/${item.id}`));
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    {t("Inspect", "Проверить")}
                  </button>
                  <strong>{item.candidate.name}</strong>
                  <p>{item.candidate.description}</p>
                  <small>
                    {item.commitSha.slice(0, 7)} ·{" "}
                    {item.candidate.license || "—"}
                  </small>
                </td>
                <td>
                  <a
                    href={item.candidate.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.package?.name ||
                      item.repository.replace("https://github.com/", "")}
                  </a>
                </td>
                <td>
                  {item.status}
                  <small>
                    {item.candidate.findings.map((f) => f.code).join(", ")}
                  </small>
                </td>
                <td>
                  {item.status === "needs_review" && (
                    <button
                      type="button"
                      disabled={busy || !confirmed}
                      onClick={() =>
                        action(`/${item.id}`, {
                          decision: "approve",
                          revision: item.revision,
                          rightsConfirmed: confirmed,
                        })
                      }
                    >
                      {t("Publish", "Опубликовать")}
                    </button>
                  )}
                  {["needs_review", "blocked"].includes(item.status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        action(`/${item.id}`, {
                          decision: "reject",
                          revision: item.revision,
                        })
                      }
                    >
                      {t("Reject", "Отклонить")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <nav aria-label={t("Candidate pages", "Страницы кандидатов")}>
          <button
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - data.limit))}
          >
            {t("Previous", "Назад")}
          </button>
          <span>
            {Math.min(offset + 1, data.total)}–
            {Math.min(offset + data.limit, data.total)} / {data.total}
          </span>
          <button
            type="button"
            disabled={loading || offset + data.limit >= data.total}
            onClick={() => setOffset((current) => current + data.limit)}
          >
            {t("Next", "Далее")}
          </button>
        </nav>
      )}
      {data?.runs?.length > 0 && (
        <section aria-labelledby="intake-runs-title">
          <h3 id="intake-runs-title">
            {t("Recent runs", "Последние запуски")}
          </h3>
          {data.runs.map((run) => (
            <details key={run.id}>
              <summary>
                {new Date(run.started_at).toLocaleString()} · {run.status} ·{" "}
                {t("Completed", "Обработано")}: {run.summary.completed} ·{" "}
                {t("Failed", "Ошибок")}: {run.summary.failed}
                {run.githubCooldownUntil > 0 && (
                  <>
                    {" "}
                    · {t("GitHub rate limit until", "Лимит GitHub до")}{" "}
                    {new Date(run.githubCooldownUntil).toLocaleString()}
                  </>
                )}
              </summary>
              <ul>
                {run.jobs.map((job, index) => (
                  <li key={`${job.repository}-${job.kind}-${index}`}>
                    <a
                      href={job.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {job.repository.replace("https://github.com/", "")}
                    </a>{" "}
                    · {job.kind} · {job.state} · {t("Attempts", "Попыток")}:{" "}
                    {job.attempts}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}
