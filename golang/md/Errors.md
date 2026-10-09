# Грешки

В Go грешките са обикновени стойности от тип `error`, които функцията връща и извикващият проверява с `if err != nil`. Пакетът `errors` и `fmt.Errorf` с `%w` от стандартната библиотека стигат, а превръщането в HTTP отговор става на едно място: `internal/httpx/problem.go`, който пише RFC 9457 `application/problem+json`.

## 1. Минимален пример

Всеки слой добавя контекст с `fmt.Errorf("...: %w", err)`. `%w` запазва оригиналната грешка, така че `errors.Is` и `errors.As` я намират през всички обвивки.

```go internal/order/service.go
func (s *Service) Cancel(ctx context.Context, id int64) error {
	o, err := s.store.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("cancel order %d: %w", id, err)
	}
	if o.Status == StatusShipped {
		return ErrAlreadyShipped
	}
	return s.store.SetStatus(ctx, id, StatusCancelled)
}
```

```go internal/order/handler.go
func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "orderID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, r, fmt.Errorf("%w: invalid order id", httpx.ErrBadRequest))
		return
	}
	if err := h.svc.Cancel(r.Context(), id); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

Handler-ът не решава статус кодове. Той подава грешката на `WriteError` и толкова.

## 2. Sentinel грешки

Sentinel грешката е exported променлива, с която се сравнява чрез `errors.Is`. Видовете, които HTTP слоят познава, са в малък пакет без зависимости, за да не импортира `httpx` domain пакетите (иначе става import cycle, защото `order` вече импортира `httpx`).

```go internal/apperr/apperr.go
package apperr

import "errors"

var (
	ErrNotFound     = errors.New("not found")    // 404
	ErrConflict     = errors.New("conflict")     // 409
	ErrInvalid      = errors.New("invalid")      // 422
	ErrForbidden    = errors.New("forbidden")    // 403
	ErrUnauthorized = errors.New("unauthorized") // 401
)
```

Domain пакетът дефинира свои sentinel грешки, които обвиват вида:

```go internal/order/model.go
var (
	ErrNotFound       = fmt.Errorf("order %w", apperr.ErrNotFound)
	ErrAlreadyShipped = fmt.Errorf("order already shipped: %w", apperr.ErrConflict)
	ErrOutOfStock     = fmt.Errorf("product out of stock: %w", apperr.ErrInvalid)
)
```

Така `errors.Is(err, order.ErrNotFound)` работи в service-а и тестовете, а `errors.Is(err, apperr.ErrNotFound)` работи в `httpx`.

## 3. Грешки от базата се превеждат в store-а

`pgx.ErrNoRows` и Postgres кодовете са детайл на storage-а. Store-ът ги превежда в domain грешки, за да не знае никой над него за pgx. Тук е и типичният пример за typed грешка с `errors.As`: `*pgconn.PgError` носи SQLSTATE кода.

```go internal/order/store.go
func (s *Store) Get(ctx context.Context, id int64) (Order, error) {
	row, err := s.q.GetOrder(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("get order %d: %w", id, err)
	}
	return toOrder(row), nil
}

func (s *Store) Create(ctx context.Context, o Order) (Order, error) {
	row, err := s.q.CreateOrder(ctx, toCreateParams(o))
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Order{}, fmt.Errorf("order number %s: %w", o.Number, apperr.ErrConflict)
	}
	if err != nil {
		return Order{}, fmt.Errorf("create order: %w", err)
	}
	return toOrder(row), nil
}
```

## 4. Превод към HTTP на едно място

`WriteError` е единственото място, където грешка става статус код, а `WriteProblem` пише отговор директно, когато няма `error`. Typed грешката `*ValidationError` от [Валидации](Validation.md) се хваща с `errors.As`, видовете с `errors.Is`, а всичко непознато е 500: логва се пълната грешка, а клиентът получава само общо съобщение.

```go internal/httpx/problem.go
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/acme/shop/internal/apperr"
)

// ErrBadRequest се ползва от Decode и от parse на path параметри.
var ErrBadRequest = errors.New("bad request")

type Problem struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail,omitempty"`
	Errors []FieldError `json:"errors,omitempty"`
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		writeProblem(w, http.StatusUnprocessableEntity, "", ve.Fields)
	case errors.Is(err, ErrBadRequest):
		writeProblem(w, http.StatusBadRequest, err.Error(), nil)
	case errors.Is(err, apperr.ErrNotFound):
		writeProblem(w, http.StatusNotFound, err.Error(), nil)
	case errors.Is(err, apperr.ErrConflict):
		writeProblem(w, http.StatusConflict, err.Error(), nil)
	case errors.Is(err, apperr.ErrInvalid):
		writeProblem(w, http.StatusUnprocessableEntity, err.Error(), nil)
	case errors.Is(err, apperr.ErrForbidden):
		writeProblem(w, http.StatusForbidden, err.Error(), nil)
	case errors.Is(err, apperr.ErrUnauthorized):
		writeProblem(w, http.StatusUnauthorized, err.Error(), nil)
	case errors.Is(err, context.Canceled):
		// Клиентът е затворил връзката, няма на кого да отговорим.
		slog.InfoContext(r.Context(), "request canceled", "path", r.URL.Path)
	default:
		slog.ErrorContext(r.Context(), "internal error", "err", err, "method", r.Method, "path", r.URL.Path)
		writeProblem(w, http.StatusInternalServerError, "", nil)
	}
}

// WriteProblem е за случаи без error стойност: 404/405 от router-а, 429 от rate limit.
func WriteProblem(w http.ResponseWriter, r *http.Request, status int, detail string) {
	writeProblem(w, status, detail, nil)
}

func writeProblem(w http.ResponseWriter, status int, detail string, fields []FieldError) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Problem{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
		Errors: fields,
	})
}
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{"type":"about:blank","title":"Conflict","status":409,"detail":"cancel order 42: order already shipped: conflict"}
```

## 5. Капани

- Винаги `%w`, не `%v`, когато обвиваш. С `%v` веригата се къса и `errors.Is` спира да намира sentinel-а.
- Не сравнявай с `err == ErrNotFound`. След първото обвиване сравнението е `false`, затова винаги `errors.Is`.
- Не проверявай `pgx.ErrNoRows` в handler-а. Ако го правиш, HTTP слоят зависи от драйвера и смяната на storage-а чупи handler-ите.
- Съобщенията на 4xx грешките стигат до клиента в `detail`. Не слагай в тях SQL, токени или лични данни.
- Логвай грешката веднъж, в `WriteError`. Ако всеки слой логва и връща, една грешка става пет реда в логовете.

## 6. Свързани документи

- [Валидации](Validation.md)
- [Handlers](Handlers.md)
- [sqlc вместо ORM](SQLC.md)
- [Logging със slog](Logging.md)
- [Context](Context.md)
