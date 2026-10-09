# Go modules и инструменти

Go modules описват зависимостите на проекта в `go.mod` и `go.sum`, а няколко CLI инструмента покриват lint, генериране на код, миграции и hot reload. Нужно ти е още в първия час на всеки нов сървис, защото `Makefile` и lint правилата трябва да са еднакви за целия екип.

## 1. Инсталация

Инструментите се инсталират в `$(go env GOPATH)/bin`, който трябва да е в `PATH`.

```bash
# golangci-lint: официалният install script, фиксирай версията в CI
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b $(go env GOPATH)/bin

go install github.com/air-verse/air@latest
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

## 2. Минимален пример

Създаваш модула с пълния import path, а не само с име, за да работят import-ите между пакетите и `go get` от други репота.

```bash
mkdir shop && cd shop
go mod init github.com/acme/shop

go get github.com/go-chi/chi/v5@latest
go get github.com/jackc/pgx/v5@latest

# маха неизползвани зависимости и добавя липсващите
go mod tidy
```

```text go.mod
module github.com/acme/shop

go 1.25

require (
	github.com/caarlos0/env/v11 v11.3.1
	github.com/go-chi/chi/v5 v5.2.1
	github.com/jackc/pgx/v5 v5.7.2
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.10.0 // indirect
)
```

Версиите в примера са илюстративни, `go get` и `go mod tidy` ги попълват сами. `go.sum` съдържа хешове на всяка зависимост и винаги се commit-ва.

## 3. Makefile

`Makefile` е единната входна точка: локално и в CI се пускат едни и същи команди.

```makefile Makefile
DB_URL ?= postgres://shop:shop@localhost:5432/shop?sslmode=disable

.PHONY: run test lint generate migrate migrate-down

run:
	air

test:
	go test -race -count=1 ./...

lint:
	golangci-lint run ./...

generate:
	go generate ./...

migrate:
	migrate -path migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path migrations -database "$(DB_URL)" down 1
```

## 4. golangci-lint

Пускаш един бинарен файл, който изпълнява десетки linters паралелно. Започни с малък, строг набор и го разширявай при нужда.

```yaml .golangci.yml
version: "2"

linters:
  default: standard
  enable:
    - bodyclose
    - errorlint
    - gosec
    - noctx
    - revive
    - sqlclosecheck

formatters:
  enable:
    - gofmt
    - goimports

run:
  timeout: 5m
```

`default: standard` включва `errcheck`, `govet`, `staticcheck`, `ineffassign` и `unused`. `noctx` хваща HTTP заявки без `context`, а `sqlclosecheck` незатворени `rows`.

## 5. go generate

`go generate ./...` обхожда пакетите и изпълнява командите от `//go:generate` коментарите. Пътят е относителен спрямо директорията на пакета.

```go internal/db/db.go
package db

//go:generate sqlc generate -f ../../sqlc.yaml
```

Генерираният код в `internal/db/sqlc/` се commit-ва, така CI и колегите не зависят от локално инсталиран `sqlc`. В CI пусни `make generate` и провери с `git diff --exit-code`, че няма разлика.

## 6. Hot reload с air

`air` следи файловете, пресъбира и рестартира `cmd/api` при всяка промяна.

```toml .air.toml
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/api ./cmd/api"
  bin = "./tmp/api"
  include_ext = ["go", "html", "sql"]
  exclude_dir = ["tmp", "web", "internal/db/sqlc"]
  delay = 500
  kill_delay = "2s"
  send_interrupt = true

[log]
  time = false
```

`send_interrupt = true` праща `SIGINT`, така graceful shutdown логиката се изпълнява и локално. Добави `tmp/` в `.gitignore`.

## 7. Капани

- Модул с име `shop` вместо `github.com/acme/shop` работи локално, но се чупи веднага щом друго репо или инструмент се опита да го import-не.
- `go mod tidy` трябва да е чист преди commit. В CI пусни `go mod tidy` и `git diff --exit-code go.mod go.sum`.
- `go install ...@latest` дава различни версии на различни машини. В CI фиксирай версиите на `golangci-lint`, `sqlc` и `migrate`.
- `migrate` без `-tags 'postgres'` се компилира без драйвер и пада с `unknown driver postgres`.
- Не редактирай ръчно файлове в `internal/db/sqlc/`, следващото `make generate` ще ги презапише.

## 8. Свързани документи

- [Структура на проекта](Project_Structure.md)
- [sqlc вместо ORM](SQLC.md)
- [Миграции](Migrations.md)
- [Docker и деплой](Docker_Deploy.md)
- [Testing](Testing.md)
