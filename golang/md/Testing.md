# Testing

Тестовете в Go са обикновени функции `TestXxx(t *testing.T)` във файлове `_test.go`, пускани с `go test`. Ползваме стандартния `testing` с `testify` за проверките, `httptest` за handler-и и testcontainers за истински Postgres в интеграционните тестове.

## 1. Инсталация

`testify` и testcontainers са само тестови зависимости, но живеят в същия `go.mod`.

```bash
go get github.com/stretchr/testify@latest
go get github.com/testcontainers/testcontainers-go/modules/postgres@latest
```

## 2. Минимален пример: table-driven тест на service

Service зависи от interface, а не от конкретния store, затова в теста подаваш fake.

```go internal/order/service.go
type orderStore interface {
	Create(ctx context.Context, userID int64, totalCents int64, items []Item) (Order, error)
}

type Service struct {
	store orderStore
	pool  *pgxpool.Pool
	log   *slog.Logger
}

func NewService(s orderStore, pool *pgxpool.Pool, log *slog.Logger) *Service {
	return &Service{store: s, pool: pool, log: log}
}
```

```go internal/order/service_test.go
package order

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeStore struct{ created []Order }

func (f *fakeStore) Create(_ context.Context, userID, total int64, items []Item) (Order, error) {
	o := Order{ID: int64(len(f.created) + 1), UserID: userID, TotalCents: total}
	f.created = append(f.created, o)
	return o, nil
}

func TestService_Place(t *testing.T) {
	tests := []struct {
		name      string
		items     []Item
		wantTotal int64
		wantErr   error
	}{
		{name: "one item", items: []Item{{ProductID: 1, Qty: 2, PriceCents: 1500}}, wantTotal: 3000},
		{name: "two items", items: []Item{{ProductID: 1, Qty: 1, PriceCents: 1000}, {ProductID: 2, Qty: 3, PriceCents: 200}}, wantTotal: 1600},
		{name: "empty cart", items: nil, wantErr: ErrEmptyOrder},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := NewService(&fakeStore{}, nil, slog.New(slog.DiscardHandler))

			o, err := svc.Place(context.Background(), 42, PlaceInput{Items: tt.items})

			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, o.TotalCents)
			assert.Equal(t, int64(42), o.UserID)
		})
	}
}
```

`require` спира теста при провал, `assert` продължава. Ползвай `require` за предусловия (няма грешка), `assert` за сравненията след това.

## 3. Handler тест с httptest и chi

Тествай през истинския router, за да хванеш и URL параметрите, и middleware-а.

```go internal/order/handler_test.go
package order

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandler_Create(t *testing.T) {
	h := NewHandler(NewService(&fakeStore{}, slog.New(slog.DiscardHandler)))
	r := chi.NewRouter()
	r.Mount("/orders", h.Routes())

	body := `{"items":[{"product_id":1,"qty":2,"price_cents":1500}]}`
	req := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	assert.JSONEq(t, `{"id":1,"user_id":0,"total_cents":3000,"status":"pending"}`, rec.Body.String())
}
```

Ако handler-ът чете потребителя от context, сложи го в теста с `req = req.WithContext(...)` през същия helper, който ползва `Authenticate` (виж [Authentication](Authentication.md)).

## 4. Интеграционен тест на store с testcontainers

Store-ът се тества срещу истински Postgres, защото SQL грешките не се хващат с fake.

```go internal/order/store_test.go
package order

import (
	"context"
	"errors"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/acme/shop/migrations"
)

func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("integration test")
	}
	ctx := context.Background()

	ctr, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("shop_test"),
		postgres.WithUsername("shop"),
		postgres.WithPassword("shop"),
		postgres.BasicWaitStrategies(),
	)
	testcontainers.CleanupContainer(t, ctr)
	require.NoError(t, err)

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	src, err := iofs.New(migrations.FS, ".")
	require.NoError(t, err)
	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	require.NoError(t, err)
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		t.Fatal(err)
	}

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func TestStore_CreateAndGet(t *testing.T) {
	store := NewStore(newTestPool(t))
	ctx := context.Background()

	created, err := store.Create(ctx, 42, 3000, []Item{{ProductID: 1, Qty: 2, PriceCents: 1500}})
	require.NoError(t, err)

	got, err := store.GetByID(ctx, created.ID)
	require.NoError(t, err)
	require.Equal(t, int64(3000), got.TotalCents)
}
```

Един контейнер на тест е бавен. При много тестове го стартирай веднъж в `TestMain` и чисти таблиците с `TRUNCATE` между тестовете.

## 5. Пускане

```bash
go test ./... -short              # само unit тестове, без Docker
go test ./... -race -cover        # всичко, включително testcontainers
go test ./internal/order -run TestService_Place/empty -v
```

`-race` хваща data race-ове в goroutine-и и винаги е включен в CI (виж [Docker и деплой](Docker_Deploy.md)).

## 6. Капани

- Без `t.Run` и уникално име на всеки случай не знаеш кой ред от таблицата е паднал.
- `testcontainers.CleanupContainer` се вика преди `require.NoError`, иначе при грешка контейнерът остава жив.
- Fake, който връща винаги успех, не тества нищо. Добави поле `err error`, когато ти трябва пътят на грешката.
- Огромни mock библиотеки и interface за всеки тип правят тестовете крехки. Малък interface в пакета, който го ползва, и ръчен fake стигат.
- Тестове, които зависят от реда си или от общо състояние в базата, падат на случаен принцип с `-shuffle=on`. Всеки тест си създава данните.

## 7. Свързани документи

- [Интерфейси и DI](Interfaces_DI.md)
- [Handlers](Handlers.md)
- [Миграции](Migrations.md)
- [sqlc вместо ORM](SQLC.md)
- [Docker и деплой](Docker_Deploy.md)
