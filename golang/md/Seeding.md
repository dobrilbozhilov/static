# Seeding

Seeding пълни локалната база с реалистични данни, за да има с какво да работиш и да демонстрираш API-то веднага след `make migrate-up`. Правиш го с отделна команда `cmd/seed`, която ползва същата конфигурация и същите sqlc заявки като API-то.

## 1. Инсталация

Фалшивите данни идват от gofakeit.

```bash
go get github.com/brianvoe/gofakeit/v7@latest
```

## 2. Минимален пример

Заявките за seed са обикновени sqlc заявки. Референтните данни (тагове) са с `ON CONFLICT DO NOTHING`, за да може командата да се пуска многократно.

```sql internal/db/queries/seed.sql
-- name: UpsertTag :exec
INSERT INTO tags (name) VALUES ($1)
ON CONFLICT (name) DO NOTHING;

-- name: CountUsers :one
SELECT count(*) FROM users;

-- name: CreateUser :one
INSERT INTO users (subject, email) VALUES ($1, $2)
RETURNING *;

-- name: CreateProduct :one
INSERT INTO products (sku, name, price_cents, stock) VALUES ($1, $2, $3, $4)
RETURNING *;
```

Командата се свързва както API-то, отказва да тръгне в production и използва фиксиран seed, така че всеки в екипа получава едни и същи данни.

```go cmd/seed/main.go
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/brianvoe/gofakeit/v7"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/shop/internal/config"
	"github.com/acme/shop/internal/db"
	"github.com/acme/shop/internal/db/sqlc"
)

func main() {
	if err := run(context.Background()); err != nil {
		slog.Error("seed failed", "err", err)
		os.Exit(1)
	}
	slog.Info("seed done")
}

func run(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Env == "production" {
		return fmt.Errorf("refusing to seed with APP_ENV=production")
	}

	pool, err := db.New(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := sqlc.New(pool)

	for _, name := range []string{"new", "sale", "eco", "bestseller"} {
		if err := q.UpsertTag(ctx, name); err != nil {
			return err
		}
	}

	// Фалшивите данни не са идемпотентни, затова ги пропускаме, ако базата вече е напълнена.
	n, err := q.CountUsers(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		slog.Info("users exist, skipping fake data", "count", n)
		return nil
	}
	return seedFake(ctx, pool, gofakeit.New(42))
}
```

## 3. Потребители, продукти и поръчки

Поръчките се записват в транзакция с helper-а от [Транзакции](Transactions.md), за да няма поръчка без редове, ако нещо гръмне по средата.

```go cmd/seed/main.go
func seedFake(ctx context.Context, pool *pgxpool.Pool, f *gofakeit.Faker) error {
	q := sqlc.New(pool)

	userIDs := make([]int64, 0, 20)
	for range 20 {
		u, err := q.CreateUser(ctx, sqlc.CreateUserParams{Subject: f.UUID(), Email: f.Email()})
		if err != nil {
			return err
		}
		userIDs = append(userIDs, u.ID)
	}

	products := make([]sqlc.Product, 0, 50)
	for i := range 50 {
		p, err := q.CreateProduct(ctx, sqlc.CreateProductParams{
			Sku:        fmt.Sprintf("SKU-%05d", i+1),
			Name:       f.ProductName(),
			PriceCents: int64(f.IntRange(199, 19999)),
			Stock:      int32(f.IntRange(0, 500)),
		})
		if err != nil {
			return err
		}
		products = append(products, p)
	}

	for range 100 {
		err := db.WithTx(ctx, pool, func(tq *sqlc.Queries) error {
			p := products[f.IntRange(0, len(products)-1)]
			qty := int32(f.IntRange(1, 3))
			o, err := tq.CreateOrder(ctx, sqlc.CreateOrderParams{
				UserID:     userIDs[f.IntRange(0, len(userIDs)-1)],
				Status:     "paid",
				TotalCents: p.PriceCents * int64(qty),
			})
			if err != nil {
				return err
			}
			return tq.CreateOrderItem(ctx, sqlc.CreateOrderItemParams{
				OrderID: o.ID, ProductID: p.ID, Quantity: qty, PriceCents: p.PriceCents,
			})
		})
		if err != nil {
			return err
		}
	}
	return nil
}
```

## 4. make seed

```makefile Makefile
.PHONY: seed db-reset
seed:
	go run ./cmd/seed

db-reset:
	migrate -path migrations -database "$(DB_URL)" drop -f
	migrate -path migrations -database "$(DB_URL)" up
	go run ./cmd/seed
```

`make db-reset` ти дава чиста база с едни и същи данни за секунди.

## 5. Капани

- Guard-ът за `APP_ENV=production` е задължителен. Една грешна променлива на средата и имаш 100 фалшиви поръчки в production.
- `gofakeit.New(0)` дава случаен seed при всяко пускане. Ползвай фиксирано число, за да са данните повторяеми.
- `subject` е `UNIQUE`, затова за него ползвай `f.UUID()`, не име или имейл, които gofakeit може да повтори при много записи. В реална среда стойността идва от `sub` на Keycloak, виж [Authentication](Authentication.md).
- Референтни данни, без които приложението не работи (роли, статуси), слагай в миграция, не в seed.
- Не пиши директни `INSERT`-и в Go. Ползвай sqlc заявките, така seed-ът се чупи при компилация, когато схемата се смени.

## 6. Свързани документи

- [Миграции](Migrations.md)
- [sqlc вместо ORM](SQLC.md)
- [Транзакции](Transactions.md)
- [Конфигурация](Configuration.md)
- [Testing](Testing.md)
