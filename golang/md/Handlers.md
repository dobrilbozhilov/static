# Handlers

Handler-ът е тънкият слой между HTTP и бизнес логиката: чете заявката, вика service и пише отговор. Ползваме само `net/http` и `encoding/json`, с два малки helper-а в пакета `httpx`, за да не се повтаря decode и encode във всеки handler.

## 1. Минимален пример

Handler-ите са методи на `Handler` struct, който държи service-а. Така зависимостите идват от конструктора, а не от глобални променливи.

```go internal/order/handler.go
package order

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/acme/shop/internal/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateOrderRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	o, err := h.svc.Create(r.Context(), req.toInput())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	w.Header().Set("Location", "/api/v1/orders/"+strconv.FormatInt(o.ID, 10))
	httpx.JSON(w, http.StatusCreated, toOrderResponse(o))
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "orderID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, r, fmt.Errorf("%w: invalid order id", httpx.ErrBadRequest))
		return
	}

	o, err := h.svc.Get(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toOrderResponse(o))
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
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

`httpx.WriteError` превръща domain грешки като `order.ErrNotFound` в 404, `httpx.ErrBadRequest` в 400 и всичко непознато в 500, виж [Грешки](Errors.md). Routes се регистрират в `h.Routes()`, виж [Routing с chi](Routing.md).

## 2. JSON helpers

`Decode` ограничава размера на тялото, отказва непознати полета и проверява, че след JSON обекта няма нищо друго. `JSON` слага header, статус и пише тялото.

```go internal/httpx/json.go
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

const maxBodyBytes = 1 << 20 // 1 MB

func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return fmt.Errorf("%w: body larger than %d bytes", ErrBadRequest, maxErr.Limit)
		}
		return fmt.Errorf("%w: invalid json: %v", ErrBadRequest, err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%w: body must contain a single json object", ErrBadRequest)
	}
	return nil
}

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Статусът вече е изпратен, остава само да логнем.
		slog.Error("write json response", "err", err)
	}
}
```

Всички грешки от `Decode` обвиват `ErrBadRequest` от `problem.go`, така `WriteError` ги превръща в 400 без допълнителни проверки в handler-а.

## 3. Тънък handler

Handler-ът прави само четири неща: парсва вход, вика един метод на service-а, мапва грешката, пише отговора. Всичко друго принадлежи на service-а.

```go internal/order/handler.go
// Лошо: бизнес правило и SQL в handler-а.
if req.Quantity > 10 && !user.IsVIP {
	httpx.WriteError(w, r, apperr.ErrInvalid)
	return
}
rows, _ := h.pool.Query(r.Context(), "SELECT ...")
```

Правилото за лимита трябва да е в `Service.Create` и да връща `ErrLimitExceeded`. Тогава същото правило важи и когато поръчка идва от Kafka consumer или от CLI, а не само от HTTP.

Подавай винаги `r.Context()` към service-а. Ако клиентът затвори връзката или изтече `middleware.Timeout`, заявката към базата се прекъсва автоматично.

## 4. Капани

- След `httpx.WriteError` или `httpx.JSON` винаги `return`. Иначе handler-ът продължава и пише втори отговор, а Go логва `superfluous response.WriteHeader call`.
- Header-ите се слагат преди `WriteHeader`. `w.Header().Set("Location", ...)` след `JSON(...)` няма ефект.
- Без `http.MaxBytesReader` клиент може да прати 2 GB тяло и да изяде паметта на pod-а.
- Не връщай domain struct директно като JSON. Всяко ново поле в модела изтича в API-то, ползвай response DTO.
- Не пускай goroutine с `r.Context()` след отговора: context-ът се отменя веднага щом handler-ът върне. За работа след отговора виж [Background jobs](Background_Jobs.md).

## 5. Свързани документи

- [Routing с chi](Routing.md)
- [JSON и DTO](JSON_DTO.md)
- [Валидации](Validation.md)
- [Грешки](Errors.md)
- [Context](Context.md)
