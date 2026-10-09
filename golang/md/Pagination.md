# Pagination

Keyset (cursor) pagination връща следващата страница спрямо последния видян ред, а не спрямо отместване, така че е еднакво бърза на страница 1 и на страница 10 000. Ползваме само нея за списъци в API-то, защото `OFFSET` чете и изхвърля всички предишни редове и пропуска или повтаря редове, когато се добавят нови записи.

## 1. Инсталация

Нужни са само sqlc заявка и стандартната библиотека (`encoding/base64`, `strconv`).

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

## 2. Минимален пример

Сортираш по `created_at` и `id`, защото `created_at` сам не е уникален. Сравнението на двойка `(created_at, id) < (...)` дава точно редовете след курсора.

```sql internal/db/queries/orders.sql
-- name: ListOrdersPage :many
SELECT * FROM orders
WHERE (created_at, id) < (sqlc.arg(cursor_created_at)::timestamptz, sqlc.arg(cursor_id)::bigint)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size);
```

Без индекс по същите колони и в същия ред Postgres сортира цялата таблица:

```sql migrations/000003_orders_created_at_idx.up.sql
CREATE INDEX orders_created_at_id_idx ON orders (created_at DESC, id DESC);
```

```sql migrations/000003_orders_created_at_idx.down.sql
DROP INDEX IF EXISTS orders_created_at_id_idx;
```

## 3. Курсор и лимит

Курсорът е непрозрачен за клиента: base64 на `created_at` и `id`. Лимитът е 20 по подразбиране и най-много 100.

```go internal/httpx/pagination.go
package httpx

import (
	"encoding/base64"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var ErrBadCursor = fmt.Errorf("%w: invalid cursor", ErrBadRequest)

type Cursor struct {
	CreatedAt time.Time
	ID        int64
}

type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

func EncodeCursor(c Cursor) string {
	raw := c.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + strconv.FormatInt(c.ID, 10)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// Без курсор връщаме "безкрайност", така една и съща заявка обслужва и първата страница.
func DecodeCursor(s string) (Cursor, error) {
	if s == "" {
		return Cursor{CreatedAt: time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), ID: math.MaxInt64}, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, ErrBadCursor
	}
	ts, idStr, ok := strings.Cut(string(b), "|")
	if !ok {
		return Cursor{}, ErrBadCursor
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return Cursor{}, ErrBadCursor
	}
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return Cursor{}, ErrBadCursor
	}
	return Cursor{CreatedAt: t, ID: id}, nil
}

func ParseLimit(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 {
		return 20
	}
	return min(n, 100)
}
```

## 4. limit+1 за следваща страница

Взимаш един ред повече от поискания. Ако е дошъл, има следваща страница: отрязваш го и правиш курсор от последния показан ред. Така не ти трябва `COUNT(*)`.

```go internal/order/store.go
func (s *Store) ListPage(ctx context.Context, c httpx.Cursor, limit int) ([]Order, bool, error) {
	rows, err := s.q.ListOrdersPage(ctx, sqlc.ListOrdersPageParams{
		CursorCreatedAt: c.CreatedAt,
		CursorID:        c.ID,
		PageSize:        int32(limit + 1),
	})
	if err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	rows = rows[:min(len(rows), limit)]

	out := make([]Order, len(rows))
	for i, r := range rows {
		out[i] = toOrder(r)
	}
	return out, hasMore, nil
}
```

```go internal/order/handler.go
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	cur, err := httpx.DecodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(w, r, err) // ErrBadCursor обвива ErrBadRequest, става 400
		return
	}
	limit := httpx.ParseLimit(r)

	items, hasMore, err := h.store.ListPage(r.Context(), cur, limit)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	page := httpx.Page[Order]{Items: items}
	if hasMore {
		last := items[len(items)-1]
		next := httpx.EncodeCursor(httpx.Cursor{CreatedAt: last.CreatedAt, ID: last.ID})
		page.NextCursor = &next
	}
	httpx.JSON(w, http.StatusOK, page)
}
```

Клиентът подава `next_cursor` обратно, докато не получи `null`:

```http
GET /orders?limit=2&cursor=MjAyNi0xMC0wOVQxMDoxNTowMC4xMjNafDQy
```

```json
{
  "items": [
    {"id": 41, "user_id": 7, "status": "paid", "total_cents": 4599, "created_at": "2026-10-09T10:14:02Z"},
    {"id": 40, "user_id": 3, "status": "pending", "total_cents": 1299, "created_at": "2026-10-09T10:12:47Z"}
  ],
  "next_cursor": "MjAyNi0xMC0wOVQxMDoxMjo0N1p8NDA"
}
```

## 5. Капани

- Сортирането трябва да е по уникална комбинация. Само `created_at` губи редове с еднакво време на границата на страницата.
- Индексът трябва да съвпада с `ORDER BY`, включително посоката. Провери с `EXPLAIN`, че няма `Sort` възел.
- Филтър по друга колона (например `user_id`) иска индекс `(user_id, created_at DESC, id DESC)`.
- Не давай на клиента да подава произволен `limit`. Таванът от 100 пази базата.
- Keyset не дава "отиди на страница 7" и общ брой. Ако UI-ят наистина ги иска, броят се смята отделно и рядко.

## 6. Свързани документи

- [sqlc вместо ORM](SQLC.md)
- [Миграции](Migrations.md)
- [Handlers](Handlers.md)
- [JSON и DTO](JSON_DTO.md)
- [Релации](Relations.md)
