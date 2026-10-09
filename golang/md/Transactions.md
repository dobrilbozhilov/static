# Транзакции

Транзакцията гарантира, че няколко записа в базата или минават всички, или нито един, например поръчка, нейните редове и намаляването на наличността. В Go с pgx я управляваш с малък helper, който прави commit при успех и rollback при грешка или panic.

## 1. Инсталация

Ползваш pgx и генерирания от sqlc код, нищо допълнително.

```bash
go get github.com/jackc/pgx/v5@latest
```

## 2. Минимален пример

`pgx.BeginFunc` отваря транзакция, вика функцията и прави `Commit`, ако тя върне `nil`, или `Rollback` при грешка. `WithTx` на генерираните `Queries` връща копие, което работи върху тази транзакция.

```go internal/db/tx.go
package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/shop/internal/db/sqlc"
)

func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(q *sqlc.Queries) error) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return fn(sqlc.New(pool).WithTx(tx))
	})
}
```

Всичко, което правиш с `q` вътре във функцията, е в една транзакция. Върнеш ли грешка, всичко се отменя, не пишеш `Rollback` на ръка.

## 3. Заключване на наличността с FOR UPDATE

Две паралелни поръчки за последната бройка не бива да минат и двете. `FOR UPDATE` заключва реда на продукта до края на транзакцията, втората заявка чака първата.

```sql internal/db/queries/products.sql
-- name: GetProductForUpdate :one
SELECT id, price_cents, stock
FROM products
WHERE id = $1
FOR UPDATE;

-- name: DecrementStock :exec
UPDATE products
SET stock = stock - sqlc.arg(quantity)::int
WHERE id = sqlc.arg(id);
```

```sql internal/db/queries/orders.sql
-- name: CreateOrderItem :exec
INSERT INTO order_items (order_id, product_id, quantity, price_cents)
VALUES ($1, $2, $3, $4);
```

## 4. PlaceOrder в service-а

Транзакцията живее в service-а, защото той знае кои стъпки са една бизнес операция. Handler-ът само вика `PlaceOrder`.

```go internal/order/service.go
package order

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/shop/internal/apperr"
	"github.com/acme/shop/internal/db"
	"github.com/acme/shop/internal/db/sqlc"
)

var (
	ErrProductNotFound = fmt.Errorf("product %w", apperr.ErrNotFound)
	ErrOutOfStock      = fmt.Errorf("out of stock: %w", apperr.ErrConflict)
)

type Line struct {
	ProductID int64
	Quantity  int32
}

type Service struct {
	store OrderStore
	pool  *pgxpool.Pool // нужен само на методите, които отварят транзакция
	log   *slog.Logger
}

func NewService(store OrderStore, pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{store: store, pool: pool, log: log}
}

func (s *Service) PlaceOrder(ctx context.Context, userID int64, lines []Line) (Order, error) {
	// Заключваме продуктите винаги в един и същ ред, иначе две поръчки могат да си направят deadlock.
	slices.SortFunc(lines, func(a, b Line) int { return cmp.Compare(a.ProductID, b.ProductID) })

	var created Order
	err := db.WithTx(ctx, s.pool, func(q *sqlc.Queries) error {
		prices := make([]int64, len(lines))
		var total int64
		for i, l := range lines {
			p, err := q.GetProductForUpdate(ctx, l.ProductID)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProductNotFound
			}
			if err != nil {
				return err
			}
			if p.Stock < l.Quantity {
				return ErrOutOfStock
			}
			prices[i] = p.PriceCents
			total += p.PriceCents * int64(l.Quantity)
		}

		o, err := q.CreateOrder(ctx, sqlc.CreateOrderParams{UserID: userID, Status: "pending", TotalCents: total})
		if err != nil {
			return err
		}
		for i, l := range lines {
			err := q.CreateOrderItem(ctx, sqlc.CreateOrderItemParams{
				OrderID: o.ID, ProductID: l.ProductID, Quantity: l.Quantity, PriceCents: prices[i],
			})
			if err != nil {
				return err
			}
			if err := q.DecrementStock(ctx, sqlc.DecrementStockParams{Quantity: l.Quantity, ID: l.ProductID}); err != nil {
				return err
			}
		}
		created = toOrder(o)
		return nil
	})
	return created, err
}
```

Service-ът, който отваря транзакции, получава и pool-а: `order.NewService(store, pool, log)` в `cmd/api/main.go`. Store-ът остава за обикновените четения извън транзакция, виж [Интерфейси и DI](Interfaces_DI.md).

`ErrOutOfStock` прекратява транзакцията и rollback-ът е автоматичен. Handler-ът превежда грешката в 409, виж [Грешки](Errors.md).

## 5. Без външни извиквания в транзакцията

Транзакцията държи връзка от pool-а и заключени редове. HTTP заявка към платежен доставчик или изпращане на имейл вътре в нея държи lock-овете секунди наред, а при rollback външното действие не се отменя.

```go internal/order/handler.go
o, err := h.svc.PlaceOrder(r.Context(), userID, lines)
if err != nil {
	httpx.WriteError(w, r, err)
	return
}
// Имейлът тръгва след commit, през background job, не вътре в WithTx.
h.river.Insert(r.Context(), jobs.SendOrderEmailArgs{OrderID: o.ID}, nil)
```

Ако имейлът задължително трябва да тръгне, запиши job-а в същата транзакция с River (виж [Background jobs](Background_Jobs.md)), той ползва същия Postgres.

## 6. Капани

- Не ползвай `pool` или store, създаден с pool-а, вътре в `WithTx`. Тези заявки минават през друга връзка, извън транзакцията. Само `q`.
- Не стартирай goroutines с `q` вътре в транзакцията. `pgx.Tx` не е safe за паралелна употреба.
- Заключвай редовете в постоянен ред (по id), иначе паралелни транзакции стигат до deadlock.
- Дръж транзакциите кратки: прочети, провери, запиши. Никакви HTTP, Kafka или имейли вътре.
- Ако `ctx` бъде отменен по средата, pgx прекъсва заявката и `BeginFunc` прави rollback. Това е желаното поведение.

## 7. Свързани документи

- [sqlc вместо ORM](SQLC.md)
- [PostgreSQL с pgx](Postgres_pgx.md)
- [Background jobs](Background_Jobs.md)
- [Грешки](Errors.md)
- [Testing](Testing.md)
