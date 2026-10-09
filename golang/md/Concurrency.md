# Goroutines и конкурентност

Goroutine е лека нишка, която пускаш с `go f()`, а channel е типизиран канал, по който goroutines си предават стойности. В един уеб сървис ги ползваш за паралелни повиквания към други системи, за worker pool-ове и за фонови цикли, а `golang.org/x/sync/errgroup` е инструментът, който прави паралелните повиквания безопасни.

## 1. Инсталация

`errgroup` е в официалния `x/sync` модул на Go екипа.

```bash
go get golang.org/x/sync@latest
```

## 2. Минимален пример

Две независими заявки паралелно: потребителят от user сървиса и редовете на поръчката от базата. Channel-ът е buffered с размер 1, за да може goroutine-ът да запише резултата и да приключи, дори ако ние върнем грешка по-рано и никога не четем.

```go internal/order/service.go
type userResult struct {
	user user.User
	err  error
}

func (s *Service) Details(ctx context.Context, orderID, userID int64) (Details, error) {
	ch := make(chan userResult, 1)
	go func() {
		u, err := s.users.Get(ctx, userID)
		ch <- userResult{u, err}
	}()

	items, err := s.store.ListItems(ctx, orderID)
	if err != nil {
		return Details{}, fmt.Errorf("list items: %w", err)
	}

	res := <-ch
	if res.err != nil {
		return Details{}, fmt.Errorf("get user: %w", res.err)
	}
	return Details{User: res.user, Items: items}, nil
}
```

## 3. errgroup за паралелни повиквания

За повече от две повиквания ползваш `errgroup`. `WithContext` отменя общия context при първата грешка, `SetLimit` ограничава колко goroutines вървят едновременно, а `Wait` връща първата грешка.

```go internal/order/service.go
func (s *Service) loadProducts(ctx context.Context, ids []int64) ([]product.Product, error) {
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(8)

	products := make([]product.Product, len(ids))
	for i, id := range ids {
		g.Go(func() error {
			p, err := s.catalog.Get(ctx, id)
			if err != nil {
				return fmt.Errorf("product %d: %w", id, err)
			}
			products[i] = p // всяка goroutine пише в свой индекс, без lock
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return products, nil
}
```

От Go 1.22 променливите на цикъла са нови за всяка итерация, затова `i` и `id` се ползват директно в closure-а.

## 4. sync.Mutex за споделена map

Map в Go не е безопасна за едновременни записи: race води до panic `concurrent map writes`. Държиш map-а и mutex-а в един struct и никога не ги излагаш навън.

```go internal/product/cache.go
package product

import "sync"

type priceCache struct {
	mu     sync.Mutex
	prices map[int64]int64
}

func newPriceCache() *priceCache {
	return &priceCache{prices: make(map[int64]int64)}
}

func (c *priceCache) Get(id int64) (int64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, ok := c.prices[id]
	return p, ok
}

func (c *priceCache) Set(id, price int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.prices[id] = price
}
```

## 5. Worker pool с buffered channel

Фиксиран брой workers четат от един channel. Buffered channel-ът поема кратки пикове, а когато е пълен, изпращачът чака: това е естественият backpressure. Pool-ът спира, когато затвориш channel-а, и `Wait` чака всички да довършат.

```go internal/order/reindex.go
package order

import (
	"context"
	"log/slog"
	"sync"
)

func (s *Service) Reindex(ctx context.Context, ids []int64) {
	jobs := make(chan int64, 100)
	var wg sync.WaitGroup

	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for id := range jobs {
				if err := s.search.Index(ctx, id); err != nil {
					slog.ErrorContext(ctx, "reindex failed", "order_id", id, "err", err)
				}
			}
		}()
	}

	for _, id := range ids {
		select {
		case jobs <- id:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
	}
	close(jobs)
	wg.Wait()
}
```

Ако на workers им трябва и обща грешка, същото се пише по-кратко с `errgroup` и `SetLimit` от секция 3.

## 6. Race detector

Пускай тестовете винаги с `-race` в CI. Той намира едновременен достъп до една и съща памет без синхронизация, дори когато тестът минава.

```bash
go test -race ./...
```

## 7. Капани

- Никога не пускай goroutine, без да знаеш как спира: от затворен channel, от `ctx.Done()` или от край на работата. Иначе изтича и държи памет и връзки до рестарта.
- Unbuffered channel, от който никой не чете, блокира goroutine-а завинаги. Това е най-честият goroutine leak.
- Panic в goroutine убива целия процес, recover middleware-ът на router-а не го хваща. Фоновите goroutines сами правят `recover`.
- Не копирай struct, който съдържа `sync.Mutex`: копието има собствен lock. Подавай го по указател, `go vet` го хваща.
- `SetLimit` се вика преди първия `Go`. Промяна на лимита, докато има активни goroutines в групата, е panic.

## 8. Свързани документи

- [Context](Context.md)
- [Graceful shutdown](Graceful_Shutdown.md)
- [HTTP клиенти](HTTP_Clients.md)
- [Testing](Testing.md)
- [Profiling с pprof](Profiling.md)
