# Интерфейси и DI

Interface в Go се удовлетворява неявно: всеки тип с нужните методи го имплементира, без `implements`. Това позволява service-ът да зависи от малък interface вместо от конкретния store, а зависимостите се подават през конструктори и се свързват на ръка в `cmd/api/main.go`, без DI framework.

## 1. Минимален пример

Правилото е "accept interfaces, return structs". Consumer-ът (service-ът) декларира interface само с двата метода, които реално ползва. Store-ът не знае за този interface и връща конкретен `*Store`.

```go internal/order/service.go
package order

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

type OrderStore interface {
	Get(ctx context.Context, id int64) (Order, error)
	Create(ctx context.Context, o Order) (Order, error)
}

type Service struct {
	store OrderStore
	pool  *pgxpool.Pool // само за транзакции, виж Transactions
	log   *slog.Logger
}

func NewService(store OrderStore, pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{store: store, pool: pool, log: log}
}

func (s *Service) Place(ctx context.Context, o Order) (Order, error) {
	if len(o.Items) == 0 {
		return Order{}, ErrEmptyOrder
	}
	created, err := s.store.Create(ctx, o)
	if err != nil {
		return Order{}, fmt.Errorf("place order: %w", err)
	}
	s.log.InfoContext(ctx, "order placed", "order_id", created.ID)
	return created, nil
}
```

```go internal/order/store.go
type Store struct {
	q *sqlc.Queries
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{q: sqlc.New(pool)}
}
```

`*Store` има и `List`, `SetStatus` и други методи, но service-ът вижда само `Get` и `Create`. Колкото по-малък е interface-ът, толкова по-лесен е fake-ът в тестовете.

## 2. Свързване в main

`main` е composition root: единственото място, което знае за всички конкретни типове. Всичко се създава с `New...` функции и се подава надолу. Не ползваме DI framework (wire, fx), защото ръчното свързване е обикновен Go код, грешките са при компилация, а не при старт, и всеки вижда зависимостите с един поглед.

```go cmd/api/main.go
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logging.New(cfg.Env, cfg.LogLevel)

	pool, err := db.New(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	defer pool.Close()

	orderStore := order.NewStore(pool)
	orderSvc := order.NewService(orderStore, pool, log)
	orderHandler := order.NewHandler(orderSvc)

	productStore := product.NewStore(pool)
	productHandler := product.NewHandler(product.NewService(productStore))

	router := server.Routes(orderHandler, productHandler)
	return server.New(cfg.HTTP.Addr, router).Run(ctx, cfg.HTTP.DrainDelay, cfg.HTTP.ShutdownTimeout)
}
```

Когато `main` порасне, извади свързването във функция `newApp(cfg, pool) *app` в същия пакет. Пак без framework.

## 3. Fake в тестовете

Понеже service-ът иска interface, в unit теста му подаваш fake, написан на ръка за няколко реда. Не ти трябва mock библиотека.

```go internal/order/service_test.go
package order

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeStore struct {
	created []Order
}

func (f *fakeStore) Get(_ context.Context, id int64) (Order, error) {
	return Order{}, ErrNotFound
}

func (f *fakeStore) Create(_ context.Context, o Order) (Order, error) {
	o.ID = int64(len(f.created) + 1)
	f.created = append(f.created, o)
	return o, nil
}

func TestPlace(t *testing.T) {
	store := &fakeStore{}
	svc := NewService(store, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	got, err := svc.Place(context.Background(), Order{Items: []Item{{SKU: "ABC-12345", Quantity: 2}}})

	require.NoError(t, err)
	require.Equal(t, int64(1), got.ID)
	require.Len(t, store.created, 1)
}
```

Store-ът се тества отделно с истински Postgres в testcontainers (виж [Testing](Testing.md)).

## 4. Капани

- Не дефинирай interface до имплементацията "за всеки случай". Interface се появява при consumer-а, когато има нужда от него.
- Не връщай interface от конструктор. `NewStore` връща `*Store`, иначе извикващият губи достъп до методите извън interface-а.
- Голям interface с 15 метода прави всеки fake огромен. Разцепи го по това какво ползва всеки consumer.
- Глобални променливи за зависимости (`var DB *pgxpool.Pool`) скриват кой какво ползва и правят паралелните тестове невъзможни.
- Interface стойност, която държи nil указател, не е `nil`. Не връщай `(*MyErr)(nil)` като `error`.

## 5. Свързани документи

- [Структура на проекта](Project_Structure.md)
- [Testing](Testing.md)
- [Handlers](Handlers.md)
- [sqlc вместо ORM](SQLC.md)
- [Graceful shutdown](Graceful_Shutdown.md)
