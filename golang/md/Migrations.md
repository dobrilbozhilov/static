# Миграции

Миграциите са номерирани SQL файлове, които променят схемата на базата стъпка по стъпка и се пазят в git заедно с кода. Ползваме golang-migrate, защото работи и като CLI, и като библиотека, а файловете са чист SQL, който sqlc чете директно.

## 1. Инсталация

CLI-ят се компилира с драйвера за Postgres чрез build tag, без него не разпознава `postgres://` URL-и. Библиотеката е за пускане на миграциите от кода.

```bash
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
go get github.com/golang-migrate/migrate/v4@latest
```

## 2. Минимален пример

Създаваш нова двойка файлове up/down с пореден номер:

```bash
migrate create -ext sql -dir migrations -seq create_orders
```

Получаваш `migrations/000001_create_orders.up.sql` и `migrations/000001_create_orders.down.sql`. Първата миграция създава основните таблици.

```sql migrations/000001_create_orders.up.sql
CREATE TABLE users (
    id         bigserial PRIMARY KEY,
    subject    text UNIQUE NOT NULL, -- OIDC "sub", виж Authentication
    email      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id          bigserial PRIMARY KEY,
    sku         text NOT NULL UNIQUE,
    name        text NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users(id),
    status      text NOT NULL,
    total_cents bigint NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id          bigserial PRIMARY KEY,
    order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  bigint NOT NULL REFERENCES products(id),
    quantity    integer NOT NULL CHECK (quantity > 0),
    price_cents bigint NOT NULL
);
```

Down файлът отменя точно това, в обратен ред:

```sql migrations/000001_create_orders.down.sql
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
```

Пускаш ги с CLI-я:

```bash
migrate -path migrations -database "$DB_URL" up
```

## 3. Makefile

Командите са дълги, затова живеят в Makefile.

```makefile Makefile
DB_URL ?= postgres://shop:shop@localhost:5432/shop?sslmode=disable

.PHONY: migrate-up migrate-down migrate-new
migrate-up:
	migrate -path migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path migrations -database "$(DB_URL)" down 1

migrate-new:
	migrate create -ext sql -dir migrations -seq $(name)
```

`make migrate-new name=add_order_notes` създава следващата двойка файлове.

## 4. Миграции от кода с embed

В production образа няма CLI. Вграждаш SQL файловете в binary-то с `//go:embed` и ги пускаш с библиотеката. `embed` вижда само файлове в своята директория, затова малкият пакет стои в самата `migrations/`.

```go migrations/migrations.go
package migrations

import (
	"embed"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var files embed.FS

func Up(databaseURL string) error {
	src, err := iofs.New(files, ".")
	if err != nil {
		return fmt.Errorf("migrations source: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, databaseURL)
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	defer m.Close()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
```

Отделна команда, която в Kubernetes пускаш като init container или Job преди API-то:

```go cmd/migrate/main.go
package main

import (
	"log/slog"
	"os"

	"github.com/acme/shop/migrations"
)

func main() {
	if err := migrations.Up(os.Getenv("DB_URL")); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}
	slog.Info("migrations applied")
}
```

Ако предпочиташ една стъпка по-малко, извикай `migrations.Up(cfg.DB.URL)` в `cmd/api/main.go` преди `db.New`. golang-migrate държи advisory lock, така че няколко реплики, стартиращи едновременно, не си пречат.

## 5. Капани

- Никога не редактирай миграция, която вече е пусната някъде. Промяната няма да стигне до тези бази. Пиши нова миграция.
- Ако миграция гръмне по средата, базата остава "dirty". Оправяш ръчно и маркираш версията с `migrate -path migrations -database "$DB_URL" force <версия>`.
- Без `-tags 'postgres'` CLI-ят дава `unknown driver postgres`.
- Без blank import на `database/postgres` библиотеката дава същата грешка.
- `CREATE INDEX` върху голяма таблица заключва записите. За production ползвай `CREATE INDEX CONCURRENTLY`, но тогава файлът трябва да съдържа само тази команда, защото не може да е в транзакция.
- Пиши down файла винаги, дори да не го ползваш в production. Локално и в тестове е безценен.

## 6. Свързани документи

- [sqlc вместо ORM](SQLC.md)
- [PostgreSQL с pgx](Postgres_pgx.md)
- [Seeding](Seeding.md)
- [Docker и деплой](Docker_Deploy.md)
- [Testing](Testing.md)
