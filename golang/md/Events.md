# Events в процеса

Go няма вграден EventEmitter, затова за събития вътре в един процес пишем малък типизиран event bus с generics: service-ът казва "поръчката е направена", а слушателите (имейл, статистика, кеш) се закачат отделно. Така service-ът не знае за имейли, а новите реакции не пипат бизнес логиката.

## 1. Минимален пример

Не трябва библиотека, bus-ът е под 50 реда. Методите в Go не могат да имат type параметри, затова `Subscribe` и `Publish` са функции, а събитията се разпознават по типа си.

```go internal/platform/events/bus.go
package events

import (
	"context"
	"log/slog"
	"reflect"
	"sync"
)

type handler struct {
	fn    func(context.Context, any)
	async bool
}

type Bus struct {
	mu       sync.RWMutex
	handlers map[reflect.Type][]handler
}

func NewBus() *Bus { return &Bus{handlers: map[reflect.Type][]handler{}} }

func Subscribe[T any](b *Bus, fn func(context.Context, T))      { add(b, fn, false) }
func SubscribeAsync[T any](b *Bus, fn func(context.Context, T)) { add(b, fn, true) }

func add[T any](b *Bus, fn func(context.Context, T), async bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	t := reflect.TypeFor[T]()
	b.handlers[t] = append(b.handlers[t], handler{
		fn:    func(ctx context.Context, e any) { fn(ctx, e.(T)) },
		async: async,
	})
}

func Publish[T any](ctx context.Context, b *Bus, event T) {
	b.mu.RLock()
	hs := b.handlers[reflect.TypeFor[T]()]
	b.mu.RUnlock()
	for _, h := range hs {
		if !h.async {
			h.fn(ctx, event)
			continue
		}
		go func() {
			defer func() {
				if r := recover(); r != nil {
					slog.Error("event handler panic", "event", reflect.TypeFor[T]().String(), "panic", r)
				}
			}()
			// заявката може да е приключила, но async слушателят трябва да довърши
			h.fn(context.WithoutCancel(ctx), event)
		}()
	}
}
```

Sync слушателите вървят в goroutine-а на заявката и паниката им стига до recover middleware-а. Async слушателите са в отделна goroutine със собствен `recover`, иначе една паника сваля целия процес.

## 2. Събитие и публикуване след commit

Събитието е обикновен struct в пакета, който го притежава.

```go internal/order/events.go
package order

type OrderPlaced struct {
	OrderID    int64
	TotalCents int64
}
```

Service-ът публикува чак след успешен commit, иначе слушателите реагират на поръчка, която може да бъде rollback-ната.

```go internal/order/service.go
func (s *Service) PlaceOrder(ctx context.Context, userID int64, lines []Line) (Order, error) {
	var created Order
	err := db.WithTx(ctx, s.pool, func(q *sqlc.Queries) error {
		// заявките от Transactions.md, накрая created = toOrder(o)
		return s.createInTx(ctx, q, userID, lines, &created)
	})
	if err != nil {
		return Order{}, err
	}
	events.Publish(ctx, s.Bus, OrderPlaced{OrderID: created.ID, TotalCents: created.TotalCents})
	return created, nil
}
```

## 3. Слушател, който пуска job

Слушателите се закачат в composition root-а. Този добавя River job за имейл, а самото пращане става в worker-а (виж [Имейли и шаблони](Emails_Templates.md)).

```go cmd/api/main.go
bus := events.NewBus()

events.SubscribeAsync(bus, func(ctx context.Context, e order.OrderPlaced) {
	_, err := riverClient.Insert(ctx, jobs.SendOrderEmailArgs{OrderID: e.OrderID}, nil)
	if err != nil {
		slog.ErrorContext(ctx, "enqueue order email", "order_id", e.OrderID, "err", err)
	}
})

events.Subscribe(bus, func(ctx context.Context, e order.OrderPlaced) {
	metrics.OrdersPlaced.Inc()
})

orderSvc := order.NewService(orderStore, pool, log)
orderSvc.Bus = bus // допълнителна зависимост, затова поле, а не параметър
```

## 4. Кога bus-ът не стига

Bus-ът живее в паметта: ако процесът падне между commit и async слушателя, събитието е изгубено. Когато реакцията е задължителна (имейл за плащане, синхронизация на склад), запиши job-а в същата транзакция с `InsertTx` като outbox, виж [Background jobs](Background_Jobs.md). Когато събитието трябва да стигне до друг сървис, публикувай го в [Kafka](Kafka.md) през outbox, а не директно от слушател.

## 5. Капани

- Публикуване вътре в транзакцията изпраща събития за промени, които после се rollback-ват.
- Sync слушател, който е бавен или вика мрежа, забавя заявката. Сложи го async.
- Async слушателите не се изчакват при shutdown. За важна работа ползвай job, не goroutine.
- `Publish` с указател (`*OrderPlaced`) и `Subscribe` със стойност са различни типове и слушателят никога не се вика. Публикувай винаги стойности.
- Не превръщай bus-а в скрит control flow: ако service-ът зависи от резултата на слушател, извикай го директно.

## 6. Свързани документи

- [Background jobs](Background_Jobs.md)
- [Kafka](Kafka.md)
- [Goroutines и конкурентност](Concurrency.md)
- [Транзакции](Transactions.md)
- [Интерфейси и DI](Interfaces_DI.md)
