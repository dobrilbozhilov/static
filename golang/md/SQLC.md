# sqlc вместо ORM

sqlc чете твоя SQL и схемата от миграциите и генерира type-safe Go функции и struct-ове върху pgx. Ползваме го вместо ORM, защото ORM-ите като GORM крият SQL-а, а sqlc генерира type-safe код от истински SQL, който виждаш, ревюираш и тунингваш.

## 1. Инсталация

sqlc е CLI инструмент, не библиотека. Генерираният код зависи само от pgx.

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go get github.com/jackc/pgx/v5@latest
```

## 2. Минимален пример

Конфигурацията е в корена на проекта. Схемата се чете директно от `migrations/`, sqlc разбира golang-migrate файловете и пропуска `.down.sql`.

```yaml sqlc.yaml
version: "2"
sql:
  - engine: "postgresql"
    schema: "migrations"
    queries: "internal/db/queries"
    gen:
      go:
        package: "sqlc"
        out: "internal/db/sqlc"
        sql_package: "pgx/v5"
        emit_json_tags: true
        overrides:
          - db_type: "timestamptz"
            go_type: "time.Time"
```

Override-ът е нужен, защото по подразбиране с pgx/v5 `timestamptz` става `pgtype.Timestamptz`, а с `time.Time` кодът е по-чист.

Всяка заявка има коментар `-- name: <Име> :<вид>`. `:one` връща един ред, `:many` slice, `:exec` само грешка.

```sql internal/db/queries/orders.sql
-- name: GetOrder :one
SELECT * FROM orders
WHERE id = $1;

-- name: ListOrdersByUser :many
SELECT * FROM orders
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: CreateOrder :one
INSERT INTO orders (user_id, status, total_cents)
VALUES ($1, $2, $3)
RETURNING *;

-- name: UpdateOrderStatus :exec
UPDATE orders SET status = $2
WHERE id = $1;
```

Генерираш кода и го commit-ваш заедно със SQL-а:

```bash
sqlc generate
```

```makefile Makefile
.PHONY: sqlc
sqlc:
	sqlc generate
```

В `internal/db/sqlc/` се появяват `db.go` (`Queries` и `New`), `models.go` (struct за всяка таблица, напр. `Order`) и `orders.sql.go` с методите `GetOrder(ctx, id int64) (Order, error)`, `CreateOrder(ctx, CreateOrderParams) (Order, error)` и т.н. Тези файлове не се редактират на ръка.

## 3. Store, който мапва към domain типове

Генерираните struct-ове са детайл на базата. Store-ът ги обвива и връща domain типовете на пакета, така handler-ите и service-ът не знаят за sqlc.

```go internal/order/model.go
package order

import (
	"fmt"
	"time"

	"github.com/acme/shop/internal/apperr"
)

var ErrNotFound = fmt.Errorf("order %w", apperr.ErrNotFound)

type Order struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	Status     string    `json:"status"`
	TotalCents int64     `json:"total_cents"`
	CreatedAt  time.Time `json:"created_at"`
}
```

```go internal/order/store.go
package order

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/shop/internal/db/sqlc"
)

type Store struct {
	q *sqlc.Queries
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{q: sqlc.New(pool)}
}

func (s *Store) Get(ctx context.Context, id int64) (Order, error) {
	row, err := s.q.GetOrder(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, err
	}
	return toOrder(row), nil
}

func (s *Store) Create(ctx context.Context, userID, totalCents int64) (Order, error) {
	row, err := s.q.CreateOrder(ctx, sqlc.CreateOrderParams{
		UserID:     userID,
		Status:     "pending",
		TotalCents: totalCents,
	})
	if err != nil {
		return Order{}, err
	}
	return toOrder(row), nil
}

func toOrder(r sqlc.Order) Order {
	return Order{
		ID:         r.ID,
		UserID:     r.UserID,
		Status:     r.Status,
		TotalCents: r.TotalCents,
		CreatedAt:  r.CreatedAt,
	}
}
```

## 4. Именувани параметри

При повече параметри `$1, $2` стават нечетими и генерираните полета получават лоши имена. С `sqlc.arg` задаваш името на полето в `Params` struct-а.

```sql internal/db/queries/orders.sql
-- name: ListOrdersByStatus :many
SELECT * FROM orders
WHERE status = sqlc.arg(status)
  AND created_at >= sqlc.arg(since)
ORDER BY created_at DESC
LIMIT sqlc.arg(max_rows);
```

Генерира `ListOrdersByStatusParams{Status, Since, MaxRows}`.

## 5. Капани

- `SELECT *` е удобно, но при нова колона в таблицата генерираният struct се сменя. Това е добре: компилаторът ти показва всички места, които трябва да прегледаш.
- Пусни `sqlc generate` в CI и провери с `git diff --exit-code`, че генерираният код е актуален.
- Nullable колона без override става `pgtype.Text`, `pgtype.Int8` и т.н. Слагай `NOT NULL` навсякъде, където е възможно.
- Не слагай бизнес логика в SQL файловете само защото е удобно. Сложните правила стоят в service-а.
- `:one` при липсващ ред връща `pgx.ErrNoRows`, а `:many` връща празен slice без грешка.

## 6. Свързани документи

- [PostgreSQL с pgx](Postgres_pgx.md)
- [Миграции](Migrations.md)
- [Релации](Relations.md)
- [Транзакции](Transactions.md)
- [Структура на проекта](Project_Structure.md)
