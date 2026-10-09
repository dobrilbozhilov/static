# Нов сървис: чеклист

Това е списъкът за първия ден на нов Go сървис, от `go mod init` до image в registry-то. Минаваш го отгоре надолу, всяка точка води към документа с детайлите.

## 1. Скелет

- [ ] Създай модула с `go mod init github.com/acme/shop` и Go 1.25 в `go.mod` ([Go modules и инструменти](Modules_Tooling.md)).
- [ ] Направи директориите `cmd/api`, `internal/server`, `internal/httpx`, `migrations` по общата структура ([Структура на проекта](Project_Structure.md)).
- [ ] Сложи `Makefile` с целите от раздел 10 и `.golangci.yml` ([Go modules и инструменти](Modules_Tooling.md)).
- [ ] Добави `.air.toml` за hot reload и `.env` в `.gitignore` ([Go modules и инструменти](Modules_Tooling.md)).
- [ ] Свържи всичко ръчно в `cmd/api/main.go`, без DI framework ([Интерфейси и DI](Interfaces_DI.md)).

## 2. Конфигурация и логове

- [ ] Опиши конфигурацията в struct с `env` tags и спри при старт, ако липсва задължителна стойност ([Конфигурация](Configuration.md)).
- [ ] Създай `slog` logger, JSON в production и текст локално, и го направи default ([Logging със slog](Logging.md)).
- [ ] Маркирай тайните с тип, който не се логва ([Logging със slog](Logging.md)).

## 3. HTTP слой

- [ ] Направи chi router с `/api` група и mount на feature route-овете ([Routing с chi](Routing.md)).
- [ ] Включи `RequestID`, request logger и `Recoverer` в правилния ред ([Middleware](Middleware.md)).
- [ ] Добави `httpx.Decode` и `httpx.JSON` с лимит на body-то ([JSON и DTO](JSON_DTO.md)).
- [ ] Връщай грешките като `application/problem+json` от едно място ([Грешки](Errors.md)).
- [ ] Валидирай входа с validator и връщай грешки по поле ([Валидации](Validation.md)).
- [ ] Задай `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` и `IdleTimeout` на `http.Server` ([Handlers](Handlers.md)).
- [ ] Хвани `SIGTERM` и спри сървъра с `Shutdown` и timeout ([Graceful shutdown](Graceful_Shutdown.md)).
- [ ] Подавай `r.Context()` до базата и външните извиквания ([Context](Context.md)).

## 4. База данни

- [ ] Създай `pgxpool` с настроени лимити и ping при старт ([PostgreSQL с pgx](Postgres_pgx.md)).
- [ ] Напиши първата миграция и пакета `migrations` с embed ([Миграции](Migrations.md)).
- [ ] Конфигурирай `sqlc.yaml` и генерирай кода от `internal/db/queries` ([sqlc вместо ORM](SQLC.md)).
- [ ] Добави transaction helper за операции с няколко заявки ([Транзакции](Transactions.md)).
- [ ] Ползвай keyset pagination за всеки list endpoint ([Pagination](Pagination.md)).
- [ ] Напиши `cmd/seed` за локални данни ([Seeding](Seeding.md)).

## 5. Сигурност

- [ ] Проверявай JWT от Keycloak с `go-oidc` в `Authenticate` middleware ([Authentication](Authentication.md)).
- [ ] Ограничи route-овете с `RequireRole` и проверявай собственост в service-а ([Authorization](Authorization.md)).
- [ ] За server-rendered страници ползвай `scs` сесии и CSRF защита ([Sessions и cookies](Sessions.md)).
- [ ] Ограничи размера на upload-ите с `http.MaxBytesReader` ([Файлове и S3](Files_S3.md)).

## 6. Интеграции

- [ ] Всеки външен HTTP клиент има timeout и retry само за идемпотентни заявки ([HTTP клиенти](HTTP_Clients.md)).
- [ ] Кеширай с Redis по cache-aside и TTL ([Redis и кеш](Redis_Cache.md)).
- [ ] Пращай имейли през background job, не в заявката ([Имейли и шаблони](Emails_Templates.md), [Background jobs](Background_Jobs.md)).
- [ ] Публикувай събития в Kafka чрез outbox в същата транзакция ([Kafka](Kafka.md)).
- [ ] Синхронните извиквания към други сървиси минават през gRPC с deadline ([gRPC](GRPC.md)).

## 7. Наблюдаемост

- [ ] Изложи `/metrics` и `/livez` на вътрешния порт със `server.NewInternal(cfg.HTTP.InternalAddr)`, а `/readyz` на публичния ([Метрики и tracing](Observability.md)).
- [ ] Добави HTTP метрики с route pattern, не с пълния път ([Метрики и tracing](Observability.md)).
- [ ] Включи OpenTelemetry с `otelhttp` и flush при shutdown ([Метрики и tracing](Observability.md)).
- [ ] Регистрирай `pprof` само на вътрешния порт ([Profiling с pprof](Profiling.md)).

## 8. Тестове

- [ ] Table-driven unit тестове за service-а с fake store ([Testing](Testing.md)).
- [ ] Handler тест през chi router-а с `httptest` ([Testing](Testing.md)).
- [ ] Интеграционен тест на store-а с testcontainers и миграции ([Testing](Testing.md)).
- [ ] Опиши API-то в `api/openapi.yaml` и генерирай сървъра ([API документация](API_Docs.md)).

## 9. Docker и CI

- [ ] Multi-stage Dockerfile с distroless `nonroot` и `.dockerignore` ([Docker и деплой](Docker_Deploy.md)).
- [ ] `compose.yaml` с Postgres, Redis и Mailpit с healthcheck-ове ([Docker и деплой](Docker_Deploy.md)).
- [ ] CI пуска `go test -race`, `golangci-lint` и билдва image с таг SHA ([Docker и деплой](Docker_Deploy.md)).
- [ ] Probes, `GOMEMLIMIT` и `terminationGracePeriodSeconds` в deployment-а ([Docker и деплой](Docker_Deploy.md)).

## 10. go.mod и Makefile

Минималният набор зависимости за сървис с база, кеш и наблюдаемост. Версиите са примерни: добавяй зависимостите с `go get <модул>@latest` и пусни `go mod tidy`, за да получиш текущите.

```text go.mod
module github.com/acme/shop

go 1.25

require (
	github.com/caarlos0/env/v11 v11.3.1
	github.com/coreos/go-oidc/v3 v3.14.1
	github.com/go-chi/chi/v5 v5.2.1
	github.com/go-playground/validator/v10 v10.26.0
	github.com/golang-migrate/migrate/v4 v4.18.3
	github.com/jackc/pgx/v5 v5.7.4
	github.com/joho/godotenv v1.5.1
	github.com/prometheus/client_golang v1.22.0
	github.com/redis/go-redis/v9 v9.8.0
	github.com/stretchr/testify v1.10.0
	github.com/testcontainers/testcontainers-go/modules/postgres v0.37.0
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.60.0
	go.opentelemetry.io/otel v1.35.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.35.0
	go.opentelemetry.io/otel/sdk v1.35.0
)

tool (
	github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen
	github.com/sqlc-dev/sqlc/cmd/sqlc
)
```

```makefile Makefile
DB_URL ?= postgres://shop:shop@localhost:5432/shop?sslmode=disable

.PHONY: dev up down gen migrate seed test lint build

dev:
	air

up:
	docker compose up -d postgres redis mailpit

down:
	docker compose down

gen:
	go tool sqlc generate
	go generate ./...

migrate:
	migrate -path migrations -database "$(DB_URL)" up

seed:
	go run ./cmd/seed

test:
	go test ./... -race -cover

lint:
	golangci-lint run

build:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/api ./cmd/api
```

Първият ден е готов, когато `make up migrate seed dev` вдига сървиса локално, а `make lint test` минава чисто.

## 11. Капани

- Пропуснатите timeouts на `http.Server` и HTTP клиентите са най-честата причина за увиснали goroutine-и в production.
- Логика в handler-ите вместо в service-а прави тестовете трудни. Handler-ът само декодира, вика и кодира.
- Миграции, пускани от всеки pod при старт, се състезават помежду си. Пускай ги като отделна стъпка в деплоя.
- Глобални променливи за pool и logger скриват зависимостите. Подавай ги през конструкторите.
- Сървис без `/readyz` получава трафик, преди базата да е достъпна.

## 12. Свързани документи

- Основи: [Go modules и инструменти](Modules_Tooling.md), [Структура на проекта](Project_Structure.md), [Конфигурация](Configuration.md), [Routing с chi](Routing.md), [Handlers](Handlers.md), [Middleware](Middleware.md), [JSON и DTO](JSON_DTO.md), [Валидации](Validation.md), [Грешки](Errors.md)
- Go специфики: [Context](Context.md), [Goroutines и конкурентност](Concurrency.md), [Graceful shutdown](Graceful_Shutdown.md), [Интерфейси и DI](Interfaces_DI.md), [Profiling с pprof](Profiling.md)
- Данни: [PostgreSQL с pgx](Postgres_pgx.md), [sqlc вместо ORM](SQLC.md), [Релации](Relations.md), [Транзакции](Transactions.md), [Миграции](Migrations.md), [Seeding](Seeding.md), [Pagination](Pagination.md), [Redis и кеш](Redis_Cache.md)
- Сигурност: [Authentication](Authentication.md), [Authorization](Authorization.md), [Sessions и cookies](Sessions.md)
- Интеграции: [Имейли и шаблони](Emails_Templates.md), [Файлове и S3](Files_S3.md), [Events в процеса](Events.md), [WebSockets](WebSockets.md), [Cron задачи](Cron.md), [Background jobs](Background_Jobs.md), [Kafka](Kafka.md), [NATS](NATS.md), [HTTP клиенти](HTTP_Clients.md), [gRPC](GRPC.md)
- Наблюдаемост: [Logging със slog](Logging.md), [Метрики и tracing](Observability.md)
- Качество и доставка: [Testing](Testing.md), [API документация](API_Docs.md), [Docker и деплой](Docker_Deploy.md)
- Архитектура: [Структура на микросървиси](Microservices_Structure.md), [Backend и фронтенд](Frontend_Backend.md)
