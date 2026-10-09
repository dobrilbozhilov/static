# PostgreSQL с pgx

`pgx` v5 е най-бързият и най-пълен PostgreSQL driver за Go, а `pgxpool` държи pool от връзки, който споделяш в целия сървис. Трябва ти от първия ден, в който сървисът има база: създаваш pool-а веднъж в `main.go` и го подаваш надолу към store-овете.

## 1. Инсталация

Взимаш само `pgx/v5`, `pgxpool` е подпакет в същия модул.

```bash
go get github.com/jackc/pgx/v5@latest
```

## 2. Минимален пример

Pool-ът се конфигурира от URL и после настройваш лимитите. `Ping` в края гарантира, че сървисът пада веднага при грешен URL, а не при първата заявка.

```go internal/db/db.go
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func New(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	// Рестартира връзките периодично, за да не държим стари след failover.
	cfg.MaxConnLifetime = time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}
```

```go cmd/api/main.go
pool, err := db.New(ctx, cfg.DB.URL)
if err != nil {
	slog.Error("db", "err", err)
	os.Exit(1)
}
defer pool.Close()

orders := order.NewStore(pool)
```

URL-ът е стандартен: `postgres://shop:shop@localhost:5432/shop?sslmode=disable`. Идва от конфигурацията, виж [Конфигурация](Configuration.md).

## 3. Заявка, която връща много редове

В този handbook заявките се генерират със sqlc (виж [sqlc вместо ORM](SQLC.md)), а pgx е driver-ът отдолу. Понякога ти трябва ръчна заявка, например за отчет. Тогава `pgx.CollectRows` с `pgx.RowToStructByName` мапва колоните по `db` таговете и затваря `rows` вместо теб.

```go internal/order/report.go
package order

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DailyTotal struct {
	Day        time.Time `db:"day"`
	Orders     int64     `db:"orders"`
	TotalCents int64     `db:"total_cents"`
}

func DailyTotals(ctx context.Context, pool *pgxpool.Pool, since time.Time) ([]DailyTotal, error) {
	rows, err := pool.Query(ctx, `
		SELECT date_trunc('day', created_at) AS day,
		       count(*)                     AS orders,
		       sum(total_cents)::bigint     AS total_cents
		FROM orders
		WHERE created_at >= $1
		GROUP BY 1
		ORDER BY 1`, since)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[DailyTotal])
}
```

Параметрите винаги са `$1, $2...`. Никога не слепвай стойности в SQL низа със `fmt.Sprintf`.

## 4. Един ред и pgx.ErrNoRows

`QueryRow` никога не връща грешка сам, тя идва от `Scan`. Ако няма ред, грешката е `pgx.ErrNoRows` и я превеждаш в своя domain грешка, за да може handler-ът да върне 404.

```go internal/user/store.go
package user

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/shop/internal/apperr"
)

var ErrNotFound = fmt.Errorf("user %w", apperr.ErrNotFound)

type Store struct{ pool *pgxpool.Pool }

func (s *Store) EmailByID(ctx context.Context, id int64) (string, error) {
	var email string
	err := s.pool.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, id).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return email, nil
}
```

Как `ErrNotFound` става `404 application/problem+json` е описано в [Грешки](Errors.md).

## 5. Капани

- `pool.Query` без да изчетеш и затвориш `rows` държи връзката заета. `pgx.CollectRows` го прави вместо теб, при ръчен цикъл винаги `defer rows.Close()` и проверка на `rows.Err()`.
- Не създавай pool на заявка. Един `*pgxpool.Pool` за процеса, той е safe за goroutines.
- `MaxConns` по всички реплики не бива да надхвърля `max_connections` на Postgres. 10 pod-а по 20 връзки са 200.
- Винаги подавай `ctx` от request-а, за да се прекъсне заявката, когато клиентът се откаже. Виж [Context](Context.md).
- `pgx.ErrNoRows` сравнявай с `errors.Is`, а не с `==`, защото често е wrap-нат.

## 6. Свързани документи

- [sqlc вместо ORM](SQLC.md)
- [Транзакции](Transactions.md)
- [Миграции](Migrations.md)
- [Конфигурация](Configuration.md)
- [Testing](Testing.md)
