# Импорт скиллов: v0.1

Состояние: Go-инструмент и подключение метаданных к каталогу готовы для локальной проверки. Это **не работающий фоновый сервис в production**. Нет HTTP-импорта в админке, очереди заданий или автоматического deploy. Реальный исходный репозиторий пользователь ещё не выбрал; тесты используют синтетический репозиторий с 40 скиллами. Публичный `src/data/imported-skills.json` остаётся пустым.

## Поток данных

```text
GitHub URL → точный commit → ZIP в памяти → SKILL.md + файлы каталога
          → структурный отчёт / риски / SHA-256
          → черновик описаний EN + RU → отдельное одобрение куратора
          → повторное скачивание и анализ того же commit
          → metadata pack → проверенный diff каталога → build / отдельный deploy
```

Скиллы не устанавливаются в Codex/Antigravity, не исполняются и не распаковываются на диск. Даже одобренная карточка содержит только описание и ссылку на конкретную версию оригинала. В карточке нет выдуманного `npx reporadars add`, результатов runtime-тестирования или счётчика совместимых агентов.

## Команды

Go 1.27.1 указан в `importer/go.mod`; Go с поддержкой toolchain selection может загрузить эту версию автоматически. Команды выполняются из `importer/`. Пути отчётов ниже — примеры; используйте отдельный приватный рабочий каталог **вне Git и web root**.

```sh
go run ./cmd/radar-import --help
go run ./cmd/radar-import scan --repo https://github.com/OWNER/REPO --out /PRIVATE/report.json
go run ./cmd/radar-import review-template --report /PRIVATE/report.json --out /PRIVATE/reviews.json
go run ./cmd/radar-import draft-request --report /PRIVATE/report.json --id IMPORT_ID --out /PRIVATE/request.json
```

`scan --ref REF` принимает ветку, тег или SHA; в отчёте всегда сохраняется разрешённый commit. `draft-request` выдаёт JSON с фиксированной инструкцией, недоверенными свидетельствами и схемой ответа, **не запускает модель**. Для каждого пригодного кандидата подготовьте отдельный запрос. Заблокированный скилл не отправляется модели.

После получения ответа Antigravity в формате `--output-format json` с `--json-schema`:

```sh
go run ./cmd/radar-import apply-draft --report /PRIVATE/report.json --reviews /PRIVATE/reviews.json --id IMPORT_ID --response /PRIVATE/response.json --out /PRIVATE/reviews-draft-1.json
```

Команда принимает только `status: SUCCESS` и строгое `structured_output` с `en`, `ru`, `category`, `concerns`. Следующий ответ применяется к предыдущему draft-файлу. Все решения остаются `pending`; модель не может заполнить `reviewer`, `reviewedAt`, `rightsConfirmed` или `decision`. Сначала закончите черновики, затем переходите к человеческому одобрению.

Куратор проверяет **все** файлы из `files`, назначение, ограничения, точность перевода, лицензирование/атрибуцию и замечания. Для выбранного скилла он заполняет в копии review-файла:

- `decision: "approve"` либо `"reject"`;
- `reviewer`: реальный идентификатор ответственного;
- `reviewedAt`: фактическое время проверки RFC3339;
- `rightsConfirmed: true` только после проверки прав на публикуемые описания и атрибуцию;
- `notes`: собственный результат проверки и её ограничения;
- полные `en`/`ru` описания: `title`, `summary`, `purpose`, `capabilities`, `steps`, `permissions`.

Ключи `id` и `bundleSha256` менять нельзя. Можно оставить в файле только кандидатов, по которым принято решение. `pending` не публикуется и вызывает отказ экспорта. Высокие риски нельзя снять одобрением: сначала исправляется upstream, затем запускается новый импорт.

```sh
go run ./cmd/radar-import export --report /PRIVATE/report.json --reviews /PRIVATE/reviews-approved.json --out /PRIVATE/publication.json
go run ./cmd/radar-import merge --catalog ../src/data/imported-skills.json --pack /PRIVATE/publication.json --out /PRIVATE/catalog-candidate.json
```

Экспорт повторно скачивает закреплённый commit, сверяет SHA-256 архива и все кандидатные данные, повторно применяет проверки и выдаёт только публичные поля. `merge` не перезаписывает исходный каталог; одинаковые записи идемпотентны, конфликтующий существующий ID отклоняется. Изменения существующей версии требуют отдельного ревью замены. Максимум 2000 карточек.

После просмотра metadata-only diff подготовленный каталог переносится в `src/data/imported-skills.json` обычным контролируемым изменением, запускается `make verify`. Commit/push/deploy требуют отдельной авторизации. Файлы отчёта, запросов и ответов не должны попадать в Git, статику, логи или каталог публикации.

Все выходные файлы создаются один раз с правами `0600`, без перезаписи. Входы — ограниченные обычные файлы, не symlink/FIFO; JSON с неизвестными/повторными полями или хвостом отклоняется. Права на рабочий каталог и отсутствие недоверенных параллельных писателей обеспечивает оператор; CLI не является публичным файловым API.

## Antigravity

Официальный CLI **1.1.27** установлен отдельно:

```text
/opt/reporadars-tools/antigravity/1.1.27/agy
```

Архив взят из официального release manifest, SHA-512 проверен перед установкой. Shell profiles, PATH, глобальные настройки и существующие credentials не изменялись. `--version` и `--help` проверены. **Google OAuth не выполнен; список доступных аккаунту моделей, реальный inference и применение разрешений пока не проверены.**

Перед подключением автоматического runner нужны:

1. Отдельный непривилегированный пользователь/контейнер и пустой рабочий каталог, без доступа к production, SMTP, базам и файлам других проектов.
2. Интерактивный вход пользователя в Google в этом изолированном контексте. Не передавайте пароль или API-ключ через чат.
3. Установка `importer/antigravity-deny-tools.json` как настроек **только этого** контекста. Это шаблон, он не активируется автоматически. Он запрещает все документированные файловые, командные, URL и MCP-действия. Не используйте `--dangerously-skip-permissions`.
4. Проверка фактического запрета инструментов на безвредном canary, отсутствия сторонних skills/hooks/MCP и выбора модели из `agy models`. Название «быстрой» модели нельзя предполагать до входа.
5. Затем runner: `--disable-slash-commands`, фиксированный schema/prompt, данные через stdin, ограничение времени/объёма вывода, отдельная process group, последовательная обработка, без скрытых retry/fallback. В текущей версии этот runner намеренно **не активирован**.

Headless CLI использует сохранённый вход и возвращает ошибку без него. JSON-adapter уже позволяет проверить весь последующий путь на сохранённом ответе модели, не выдавая fixture за реальную генерацию.

## Проверки и ограничения безопасности

- Только публичные HTTPS GitHub `owner/repo`; без credentials, query, fragment, произвольных hosts или редиректов. DNS-адреса разрешённых GitHub API/codeload проверяются и фиксируются для соединения. Запросы без proxy; общий deadline 90 секунд.
- ZIP: до 32 MiB, суммарное раскрытие до 64 MiB, до 10000 entries, до 512 KiB на файл, до 200 скиллов. Symlinks, special files, traversal, неоднозначные/case-colliding пути и повреждённые CRC отклоняются.
- YAML: обязательные name/description, ограничение размера/глубины, без aliases, anchors, повторных ключей и пользовательских tags.
- Каждый пакет включает весь каталог скилла и корневые LICENSE/COPYING. Внешние `../` ссылки блокируются. Необнаруженные динамические/нестандартные зависимости остаются предметом ручного ревью; это не анализатор полного dependency graph.
- Текстовое выявление remote shell execution, destructive commands, prompt overrides, доступа к credentials, privilege escalation и динамического исполнения. Найденные известные secret-patterns блокируют пакет и убирают его текст из model input. **Это не полный secret scanner**: неизвестные форматы, обфускация, замаскированные инструкции и URL могут остаться незамеченными.
- Бинарные файлы или превышение полного текстового бюджета блокируют пакет. До 200 файлов и 256 KiB review text на скилл; до 8 MiB текста на отчёт, сериализованный JSON также ограничен 8 MiB. Большой/сильно экранированный отчёт может потребовать разделения репозитория.
- `qualityScore` — только структурная эвристика (метаданные, workflow, примеры, проверка, scope, output). Порог 60 не означает реальную полезность. Семантику, достоверность и скрытое поведение оценивает куратор; статическое/AI-ревью не доказывает безопасность.
- Approval-файл — операторский артефакт, а не криптографически подписанное свидетельство. Не выдавайте доступ на его запись недоверенным пользователям. При переносе в админку нужны authenticated jobs, неизменяемый audit log и отдельная роль публикации.

## Проверка разработки

Из корня проекта:

```sh
make verify-importer
make verify
```

CI вызывает тот же `make verify`: Go race/unit tests + vet, сборка, JS/worker/auth tests и браузерные регрессии. Тесты импорта не запускают модели, не отправляют email, не изменяют production и не исполняют найденный код.

## Первичные источники

- [Agent Skills specification](https://agentskills.io/specification)
- [GitHub commit API](https://docs.github.com/en/rest/commits/commits#get-a-commit)
- [Go archive/zip](https://pkg.go.dev/archive/zip), [YAML v3](https://pkg.go.dev/go.yaml.in/yaml/v3)
- [Antigravity installation and auth](https://www.antigravity.google/docs/cli/install/), [headless JSON](https://www.antigravity.google/docs/cli/headless/), [permissions](https://www.antigravity.google/docs/cli/permissions/)
