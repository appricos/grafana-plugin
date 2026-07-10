# Grafana-интеграция для Pushinator — публичный App Plugin

## Контекст

У Pushinator уже есть два источника событий, доставляемых через `pushinator-adapter`: Shopify (`shopify-app` → adapter) и Stripe (`stripe-app` → adapter, реализовано 2026-07-09/10, проверено вживую end-to-end). Нужен третий источник — Grafana Alerting, с жёстким условием: **pushinator.com не трогаем вообще** — весь UI настройки живёт внутри Grafana, как Shopify-приложение живёт внутри Shopify Admin, и плагин должен быть опубликован в публичном Grafana Plugin Catalog.

`pushinator-adapter` изначально спроектирован source-agnostic именно для этого (см. память `adapter_reusable_patterns`), и Stripe-вертикаль — почти идеальный архитектурный прецедент: нет OAuth/install-хендшейка, доставку делает встроенный webhook-механизм внешней платформы, а маленький UI внутри платформы-хоста управляет Pushinator-токеном/каналами через подписанное API на adapter'е. Grafana ложится в ту же форму, с одним реальным отличием в том, как embedded UI аутентифицируется к adapter'у (см. ниже).

## Архитектура

Два независимых пути, как и в Stripe-вертикали:

**Путь доставки (без участия плагина):** у Grafana Alerting есть встроенный **webhook contact point** — любой HTTPS URL, с нативной HMAC-SHA256 подписью запроса. Никакого Grafana-плагина не нужно просто чтобы *принимать* алерты. Contact point шлёт POST на `https://adapter.appricos.com/webhooks/grafana/:token` — та же форма, что и `/webhooks/stripe/:token` сегодня.

**Путь настройки (новый плагин):** публичный **Grafana App Plugin** (`grafana-app`, репозиторий-сосед `shopify-app`/`stripe-app`) рендерит страницу конфигурации внутри Grafana → Apps. Там админ вставляет свой Pushinator account token, управляет каналами и жмёт Connect — что (а) регистрирует установку на adapter'е и (б) автоматически создаёт Grafana contact point + notification policy через собственный API Grafana, так что в обычном случае ничего не нужно копипастить руками.

### Почему трюк из stripe-app сюда не переносится

`stripe-app` использует один общий `STRIPE_APP_SIGNING_SECRET` на всех мерчантов, и это безопасно **только** потому, что подпись делает сам бэкенд Stripe: UI-расширение вызывает `fetchStripeSignature()`, который бьёт в `/v1/apps/app_embedded_backend_signature` на бэкенде Stripe, используя уже аутентифицированную сессию мерчанта — сам секрет никогда не попадает в браузер. У Grafana нет аналогичного доверенного сервиса подписи для сторонних плагинов, а код публичного плагина (JS-бандл **или** скомпилированный Go-бэкенд) уезжает к каждому инсталлятору — значит, зашитый в него секрет фактически публичен.

**Решение:** adapter выдаёт свежий, случайный, неугадываемый секрет **на каждую установку отдельно**, при первом обращении — без необходимости в pre-shared секрете для этого одного bootstrap-вызова, по той же модели доверия, что уже проверена на per-shop `stripeWebhookToken` Stripe-вертикали (неугадываемый токен в URL, а не хендшейк). **Go-бэкенд компонент** плагина хранит этот секрет в собственном зашифрованном per-installation `secureJsonData` Grafana (никогда не уходит на фронтенд/в браузер в открытом виде) и использует его как bearer-токен на все последующие вызовы к adapter'у.

## Изменения в `pushinator-adapter` (новая Grafana-вертикаль)

Зеркалит Stripe-вертикаль файл в файл. Новые файлы:

- `src/lib/crypto-grafana.ts` — `verifyGrafanaWebhookSignature` (HMAC-SHA256; точные названия заголовков — вероятно `X-Grafana-Signature` + заголовок таймстампа — сверить с доками Grafana webhook-notifier на этапе реализации, по той же логике, по которой `crypto-stripe.ts` изолировал схему Stripe `t=…,v1=…` вместо обобщения верификатора Shopify) + `generateWebhookToken()` (можно скопировать реализацию из `crypto-stripe.ts` дословно — она уже общая, не Stripe-специфичная).
- `src/lib/topics-grafana.ts` — у алертов Grafana нет фиксированной топик-таксономии, как у вебхуков Shopify/Stripe. Маппим собственное поле `status` Grafana на `SELECTABLE_TOPICS = ["firing", "resolved"]` (2 пункта), форматируем текст уведомления из `alerts[]`/`commonLabels`/`commonAnnotations` (суммаризация батчей из нескольких алертов, например «3 алерта firing: HighCPU (web-1), …»).
- `src/routes/webhooks-grafana.ts` — `POST /webhooks/grafana/:token`, структурно идентичен `routes/webhooks-stripe.ts`: находим shop по токену, проверяем подпись секретом этого конкретного shop, fan-out по подходящим каналам, кладём в очередь.
- `src/lib/grafana-app-auth.ts` — новый middleware `requireGrafanaAppSecret`, сверяет `Authorization: Bearer <secret>` с **per-account** хэшем в D1 (timing-safe сравнение) — не с одним общим секретом, как `requireStripeAppSignature`/`requireInternalSecret`.
- `src/routes/grafana-app-api.ts` — POST-only RPC API для Go-бэкенда плагина, зеркалит `routes/stripe-app-api.ts`:
  - `/grafana-app/register` — **без авторизации** (это и есть bootstrap-вызов); выдаёt `accountId` + `managementSecret`, создаёт строку shop, возвращает оба значения один раз.
  - `/grafana-app/token/set`, `/token/get`, `/channels/list|create|update|delete`, `/webhook/status/get`, `/disconnect` — все под `requireGrafanaAppSecret`, в остальном идентичный CRUD Stripe-аналогам (переиспользует `encryptToken`/`decryptToken`/`last4` из `lib/crypto.ts` и CRUD-клиент каналов Pushinator из `lib/pushinator-channels.ts` — там ничего менять не нужно).
- `src/lib/process-event-grafana.ts` — зеркалит `process-event-stripe.ts` один в один (читает форматтер из `topics-grafana.ts`, репортит `source: "grafana"` в общий `PushinatorDestination.send()` из `lib/destinations.ts`).
- `src/queue-grafana.ts` — зеркалит `queue-stripe.ts`, шлёт в новый биндинг `GRAFANA_EVENTS_QUEUE`.
- `src/db/schema.ts` — расширить `shops`: `grafanaWebhookToken` (unique), `grafanaManagementSecretHash`, `grafanaLastEventAt` (все nullable, та же модель «независимых половин», что уже применена для Stripe-колонок). Новая Drizzle-миграция.
- `src/index.ts` — подключить два новых route-модуля; добавить ветку `batch.queue === "grafana-events"` в существующий диспетчер `queue()` (по форме как текущая ветка Shopify/Stripe).
- `wrangler.toml` — новые `[[queues.producers]]`/`[[queues.consumers]]` для `grafana-events`/`grafana-events-dlq` (создать один раз через Cloudflare dashboard перед первым деплоем, как и существующие очереди), новый биндинг `GRAFANA_EVENTS_QUEUE`.

Таблицы `channels`/`deliveryLog` менять не нужно — `shopDomain` уже общий ключ на все вертикали.

## `grafana-app` (новый репозиторий — Grafana App Plugin)

Скаффолдинг через `npx @grafana/create-plugin` (app plugin, с бэкендом). Репозиторий-сосед `shopify-app`/`stripe-app`, тот же плоский layout.

**Фронтенд** (React/TypeScript, Grafana plugin SDK): одна страница `AppConfig` — поле Pushinator account token + кнопка Connect, список/создание/редактирование/удаление каналов (тот же UX, что и Channels-страницы `shopify-app` / `ui/src/views/Settings.tsx` в `stripe-app`), статус-баннер (Connected/Not connected + время последнего события, по аналогии с баннером на `stripeLastEventAt`), кнопка **Disconnect**, которая полностью удаляет данные аккаунта на adapter'е (тот же урок «full delete, а не status-флаг», уже применённый дважды — см. память `adapter_reusable_patterns`). Все вызовы идут через `getBackendSrv().fetch('api/plugins/<id>/resources/...')`, никогда напрямую на adapter — секрет установки остаётся на сервере.

**Бэкенд** (Go, `grafana-plugin-sdk-go`): resource-хендлеры под каждый вызов фронтенда. Хранит `managementSecret` в `AppInstanceSettings.DecryptedSecureJSONData` (собственное зашифрованное per-installation хранилище настроек Grafana — не нужна отдельная система хранения секретов с нашей стороны). Вызывает `/grafana-app/*` API adapter'а сервер-сервер, та же форма bearer-токена, что и у `requireInternalSecret` сегодня, только per-installation, а не глобальный.

**Автопровижининг**: при Connect бэкенд запрашивает у Grafana **plugin service account** (`grafana.com/developers/plugin-tools/how-to-guides/app-plugins/use-a-service-account`) и, если разрешение выдано, вызывает собственный provisioning API алертинга Grafana (`POST /api/v1/provisioning/contact-points` + `/policies`), создавая webhook contact point, указывающий на `https://adapter.appricos.com/webhooks/grafana/:token` с уже подставленным HMAC-секретом — ноль ручных действий, то, что и просили («как у Shopify»). Если админ не выдал это разрешение — fallback на показ URL + секрета для ручной вставки в Grafana Alerting → Contact points (всё равно полностью рабочий вариант, просто один лишний шаг руками — точную строку разрешения, например `alerting.notifications:write`, сверить на этапе реализации).

**`plugin.json`**: заявить минимальную версию Grafana, запрашиваемые permissions сервис-аккаунта, и любой outbound-network allowlist, которого требует платформа Grafana-плагинов (проверить аналог CSP/`connect-src`-ограничения — в `stripe-app.yaml` `content_security_policy.connect-src` потребовал полный путь, а не голый домен, это реально аукнулось при сборке Stripe-приложения — стоит проверить Grafana-аналог до первой отправки на публикацию).

## Публикация (публичный каталог)

1. Локальная разработка через `docker compose`, который скаффолдит `@grafana/create-plugin` (поднимает настоящую Grafana с загруженным плагином).
2. Подписание для локального/приватного тестирования (ревью на этом этапе не нужно).
3. Отправка через процесс публикации плагинов Grafana: автоматическая валидация → ручное код/security-ревью → подписание для публичного листинга в каталоге. По доступным докам выглядит легче процесса Shopify, но стоит закладывать минимум один круг ревью.

## Проверка

- `pushinator-adapter`: `pnpm typecheck` / `pnpm check` (те же команды, что уже использовались для Stripe-вертикали, см. её `PLAN.md`), затем `wrangler dev` и вручную подписанный синтетический Grafana-вебхук POST на `/webhooks/grafana/:token`, чтобы изолированно проверить путь adapter'а до подключения реальной Grafana.
- `grafana-app`: локальная Grafana через скаффолженный docker compose, настоящее alerting-правило, сконфигурированное на firing/resolved, подтвердить, что contact point (автопровижененный или вставленный руками) доставляет событие end-to-end в реальный канал Pushinator — тот же стиль проверки «вызвать настоящее событие, дождаться прихода», что уже использовался для Shopify (dev-стор `notification-test`) и Stripe (`stripe trigger customer.created`).

## Отмечено для уточнения на этапе реализации (не блокирует план)

- Точные названия заголовков подписи Grafana-вебхука (`crypto-grafana.ts`).
- Точная строка(и) permission сервис-аккаунта плагина, нужная для provisioning API алертинга.
- Дублировать ли `generateWebhookToken()` в `crypto-grafana.ts` (соответствует текущей конвенции изоляции по вертикалям) или вынести в общий util — по умолчанию дублировать, консистентно с тем, как `crypto-stripe.ts` держится изолированно от `crypto.ts`.
