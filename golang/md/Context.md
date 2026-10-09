# Context

`context.Context` от стандартния пакет `context` носи deadline, сигнал за отказ и малко request-scoped данни през всички слоеве на една заявка. Нужен ти е навсякъде, където има I/O: заявка към базата, HTTP повикване, публикуване в Kafka, така че когато заявката приключи или клиентът си тръгне, цялата работа под нея спира.

## 1. Минимален пример

Правилото е просто: `ctx context.Context` е първият параметър на всяка функция, която прави I/O или вика такава. Handler-ът взима `r.Context()` и го подава надолу без промяна.

```go internal/order/handler.go
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
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
```

```go internal/order/service.go
func (s *Service) Get(ctx context.Context, id int64) (Order, error) {
	return s.store.Get(ctx, id)
}
```

```go internal/order/store.go
func (s *Store) Get(ctx context.Context, id int64) (Order, error) {
	row, err := s.q.GetOrder(ctx, id) // pgx прекъсва заявката, ако ctx бъде отменен
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("get order %d: %w", id, err)
	}
	return toOrder(row), nil
}
```

## 2. Timeout за изходящо повикване

Когато викаш външна система, слагаш собствен по-къс timeout с `context.WithTimeout`. Новият context наследява и отказа на родителя, така че спира при което от двете настъпи първо.

```go internal/order/service.go
func (s *Service) Quote(ctx context.Context, o Order) (Money, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	price, err := s.shipping.Quote(ctx, o.Address, o.Weight())
	if err != nil {
		return Money{}, fmt.Errorf("shipping quote: %w", err)
	}
	return price, nil
}
```

`defer cancel()` е задължителен: освобождава таймера веднага щом функцията свърши, вместо да чака изтичането му.

## 3. Отказ, когато клиентът си тръгне

`net/http` отменя `r.Context()`, когато клиентът затвори връзката. pgx и `net/http` клиентът го забелязват и връщат грешка, която обвива `context.Canceled`. В дълги цикли проверяваш сам:

```go internal/order/service.go
func (s *Service) Export(ctx context.Context, w io.Writer, ids []int64) error {
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return err
		}
		o, err := s.store.Get(ctx, id)
		if err != nil {
			return err
		}
		if err := writeCSV(w, o); err != nil {
			return err
		}
	}
	return nil
}
```

`WriteError` разпознава `context.Canceled` и не го логва като 500 (виж [Грешки](Errors.md)).

## 4. Работа, която трябва да завърши след отговора

Понякога искаш да отговориш веднага, но да довършиш нещо кратко след това, например audit запис. `context.WithoutCancel` пази стойностите (request id, user), но не наследява отказа, затова винаги добавяй собствен timeout.

```go internal/order/handler.go
func (h *Handler) audit(r *http.Request, action string, orderID int64) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
	go func() {
		defer cancel()
		if err := h.audits.Record(ctx, action, orderID); err != nil {
			slog.ErrorContext(ctx, "audit failed", "err", err, "order_id", orderID)
		}
	}()
}
```

Ако работата не бива да се губи при рестарт (имейл за потвърждение, плащане), не я пускай в goroutine, а като job в [Background jobs](Background_Jobs.md).

## 5. Стойности в context

В context слагаш само request-scoped метаданни: request id, автентикирания потребител, trace. Зависимости (store, logger, config) се подават през конструктора. Ключът е от unexported тип, за да не може друг пакет случайно да го презапише.

```go internal/httpx/middleware.go
type ctxKey int

const requestIDKey ctxKey = iota

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
```

## 6. Капани

- Не пази `ctx` в поле на struct. Подавай го като параметър, иначе един context от стара заявка ще отменя работа на нова.
- Не подавай `nil` context. Ако нямаш, ползвай `context.Background()` в `main` и тестовете, `context.TODO()` само временно.
- Goroutine с `r.Context()` след като handler-ът е върнал отговор получава вече отменен context. Затова е `WithoutCancel` в секция 4.
- `context.WithValue` с ключ `string` е капан: два пакета с ключ `"user"` се презаписват тихо.
- Не крий задължителни параметри в context. Ако функцията не работи без стойност, тя е параметър.

## 7. Свързани документи

- [Грешки](Errors.md)
- [Middleware](Middleware.md)
- [HTTP клиенти](HTTP_Clients.md)
- [Goroutines и конкурентност](Concurrency.md)
- [Graceful shutdown](Graceful_Shutdown.md)
