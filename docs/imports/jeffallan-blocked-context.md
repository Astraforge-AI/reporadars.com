# Почему были заблокированы 13 скиллов Jeffallan

Контекстный разбор от 2026-09-07, **не снятие блокировок и не одобрение**.
Источник: `Jeffallan/claude-skills`, commit
`882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf`; ZIP SHA-256
`9da511d6934e2ab3f0381e19247194e06809ba668d532da1d720dc214526ce6b`.
Проверены контексты всех high-срабатываний из сохранённого `report.json`
по закреплённому ZIP; код, команды и найденные скиллы не запускались.

## Короткий ответ

Это были автоматические блокировки по текстовым шаблонам. Сканер пока не
различает пример приложения, защитный тест и инструкцию агенту достаточно
точно. Формулировка «13 вредоносных скиллов» была бы неверной.

- **6 пакетов:** все их high-срабатывания в этом отчёте объясняются примерами
  кода, тестами защиты или образцами для сканера секретов. Это ложные
  срабатывания по указанной причине, не доказательство безопасности пакета.
- **3 пакета:** реальные ссылки на документацию соседнего скилла, не включённую
  в проверяемый индивидуальный пакет. Проблема полноты, не вредоносность.
- **4 пакета:** команды с потенциально опасными побочными эффектами, требующие
  условий применения и проверки. Некоторые дополнительные срабатывания внутри
  этих же пакетов тоже ложные.

## Каждый пакет и свидетельства

Все пути ниже относительны к корню закреплённого репозитория. Ссылки ведут на
ту же неизменяемую версию. Числа — фактические строки исходных файлов.

| Пакет | Что сработало и контекст | Контекстная оценка / следующий шаг |
| --- | --- | --- |
| `debugging-wizard` | `DESTRUCTIVE_COMMAND`: [quick-fixes.md:136](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/debugging-wizard/references/quick-fixes.md#L136) — совет удалить зависимости **и package-lock.json**, затем переустановить. | Реальный риск изменения фиксированных версий и удаления файлов при неверном cwd. Не malware; рецепт требует явной области, сохранения lockfile/плана восстановления и согласия. |
| `fastapi-expert` | `OUTSIDE_SKILL_REFERENCE`: [migration-from-django.md:964](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/fastapi-expert/references/migration-from-django.md#L964) — cross-reference на `legacy-modernizer`. | Настоящая внешняя ссылка. Проверить разрешение пути и включение зависимости в полный review bundle; один факт наличия соседнего скилла в репозитории этого не обеспечивает. |
| `golang-pro` | `DESTRUCTIVE_COMMAND`: [project-structure.md:280](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/golang-pro/references/project-structure.md#L280) — clean-target удаляет `BUILD_DIR`, в примере задан `bin` (строка 249). `OUTSIDE_SKILL_REFERENCE`: строка 58 — локальный Go `replace`. | Удаление build-артефактов нормально при проверенной области, но переопределяемую переменную нельзя считать безопасной автоматически. `replace` — пример приложения, ложное срабатывание именно правила зависимости скилла. |
| `kubernetes-specialist` | `SECRET_PATTERN`: [configuration.md:98 и 151](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/kubernetes-specialist/references/configuration.md#L98) — усечённые примеры private keys с многоточиями. `REMOTE_EXECUTION`: [multi-cluster.md:151](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/kubernetes-specialist/references/multi-cluster.md#L151), [service-mesh.md:9 и 322](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/kubernetes-specialist/references/service-mesh.md#L9) — загрузка и немедленный запуск установщиков Submariner, Istio, Linkerd. | Полноценные private keys в отмеченных блоках не обнаружены: тела усечены и содержат многоточия. Но remote-execution риск остаётся: нужны проверка содержимого/версии/целостности и отдельное разрешение на запуск. |
| `nestjs-expert` | `OUTSIDE_SKILL_REFERENCE`: [migration-from-express.md:989](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/nestjs-expert/references/migration-from-express.md#L989) — ссылка на `legacy-modernizer`. | Реальная внешняя ссылка; проверить полноту и корректное разрешение зависимости. |
| `postgres-pro` | `DESTRUCTIVE_COMMAND`: [replication.md:36 и 377](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/postgres-pro/references/replication.md#L36) — очистка PostgreSQL data directory перед base backup/восстановлением. | Существенный риск потери базы при применении не к тому экземпляру. Это административный рецепт, не доказанная атака. Нужны проверка роли узла, точного каталога, пригодного backup и явное разрешение. |
| `prompt-engineer` | `PROMPT_OVERRIDE`: [evaluation-frameworks.md:385](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/prompt-engineer/references/evaluation-frameworks.md#L385), [system-prompts.md:301 и 469](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/prompt-engineer/references/system-prompts.md#L301). Это adversarial test data и прямое указание **не** исполнять инъекции. | Ложное срабатывание трактовки «инструкция атакует проверяющего». Следующий шаг — учитывать защитный контекст, сохраняя проверки настоящих инъекций. |
| `security-reviewer` | `SECRET_PATTERN`: [secret-scanning.md:62](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/security-reviewer/references/secret-scanning.md#L62) — таблица Pattern/Example, образец AWS Access Key с окончанием `EXAMPLE`. | Документированный образец для детектора, не подтверждённый действующий ключ. Его работоспособность не проверялась. Ложное срабатывание как утверждение об утечке; чувствительные строки здесь не воспроизводятся. |
| `shopify-expert` | `OUTSIDE_SKILL_REFERENCE`: [SKILL.md:131](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/shopify-expert/SKILL.md#L131), [app-development.md:187, 493, 494, 848](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/shopify-expert/references/app-development.md#L187) — TypeScript imports приложения и тестов. | Ложные срабатывания: это не просьба читать файлы вне установленного скилла. Не исключать все code blocks из сканирования; различать назначение конкретной ссылки. |
| `spring-boot-engineer` | `OUTSIDE_SKILL_REFERENCE`: [cloud.md:475](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/spring-boot-engineer/references/cloud.md#L475) — пример Dockerfile, распаковка JAR из соседнего каталога сборки. | Ложное срабатывание зависимости скилла: это build-path внутри примера приложения. |
| `terraform-engineer` | `OUTSIDE_SKILL_REFERENCE`: [module-patterns.md:266](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/terraform-engineer/references/module-patterns.md#L266), [testing.md:183 и 227](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/terraform-engineer/references/testing.md#L183) — локальный Terraform module source и путь Terratest к examples. | Ложные срабатывания именно внешней зависимости скилла. Это не разрешение запускать инфраструктурные примеры: их побочные эффекты проверяются отдельно. |
| `typescript-pro` | `OUTSIDE_SKILL_REFERENCE`: [configuration.md:88 и 135](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/typescript-pro/references/configuration.md#L88) — project references и alias соседнего пакета в примере monorepo. | Ложные срабатывания: пути описывают структуру приложения, а не зависимость review bundle. |
| `vue-expert-js` | `OUTSIDE_SKILL_REFERENCE`: [SKILL.md:40–42](https://github.com/Jeffallan/claude-skills/blob/882ef55e377dbf9a4dbe496bb41ac6ccd0e555cf/skills/vue-expert-js/SKILL.md#L40) — явная переадресация к трём справочникам `vue-expert`. | Реальная зависимость. Нужен разрешённый и полностью проверенный состав пакета, а не пропуск проверки соседних файлов. |

## Откуда взялись ещё 24 удержанных скилла

Первичный отчёт: **67 найдено = 13 blocked + 54 needs_review**. Из этих 54
`draft-request` подготовил **30** запросов и удержал **24** по отдельному фильтру.
В текущем `importer/internal/intake/drafts.go`, функция
`hasHighOrSecretFinding`, запрещено любое имя замечания, содержащее `SECRET`.
Поэтому medium-замечание `SECRET_ACCESS` (например, environment/config access
в примере) тоже не проходит. Это **не ещё 24 найденных утечки** и не те же 13.

## Что изменено этим разбором

Только объяснение. Исходный отчёт, 67 pending-решений, scanner rules, model-input
gate и публичный каталог не изменены. Подготовленные запросы не стали ответами:
в сохранённом запуске **0 модельных описаний и 0 публикаций**. Проверку аккаунта
Antigravity в этой задаче заново не запускали; предыдущий отказ eligibility
описан в [отчёте первого импорта](jeffallan-claude-skills.md).

Обоснованный следующий этап — отдельная узкая доработка классификации
срабатываний с регрессионными тестами, не массовое отключение защиты. Затем
новый скан и кураторское ревью полных пакетов. Этот разбор не выполнял полный
семантический аудит всех файлов, runtime-тестирование или проверку удалённых
установщиков; контекст high-срабатываний сам по себе не достаточен для одобрения.
