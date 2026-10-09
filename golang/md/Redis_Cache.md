# Redis и кеш

Redis е in-memory хранилище, което ползваш за кеш пред Postgres, броячи за rate limiting и краткоживеещи данни. Клиентът е go-redis v9, който сам управлява pool от връзки и е safe за goroutines.

## 1. Инсталация

```bash
go get github.com/redis/go-redis/v9@latest
```

## 2. Минимален пример

Клиентът се създава от URL (`redis://:password@localhost:6379/0`) веднъж при старта, а `Ping` проверява, че Redis е достъпен.

```go internal/platform/redis/redis.go
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

func New(ctx context.Context, url string) (*goredis.Client, error) {
	opt, err := goredis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := goredis.NewClient(opt)

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		rdb.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return rdb, nil
}
```

```go cmd/api/main.go
rdb, err := redis.New(ctx, cfg.Redis.URL)
if err != nil {
	slog.Error("redis", "err", err)
	os.Exit(1)
}
defer rdb.Close()
```

Пакетът се казва `redis` като библиотеката, затова в `main.go` го импортираш с alias, ако ти трябват и двата.

## 3. Cache-aside за продукт

Четеш от кеша, при липса четеш от базата и записваш в кеша с TTL. Липсващ ключ не е истинска грешка: go-redis връща `redis.Nil`.

```go internal/product/cache.go
package product

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const productTTL = 10 * time.Minute

type CachedStore struct {
	store *Store
	rdb   *redis.Client
}

func productKey(id int64) string { return "product:" + strconv.FormatInt(id, 10) }

func (c *CachedStore) Get(ctx context.Context, id int64) (Product, error) {
	b, err := c.rdb.Get(ctx, productKey(id)).Bytes()
	if err == nil {
		var p Product
		if err := json.Unmarshal(b, &p); err == nil {
			return p, nil
		}
	} else if !errors.Is(err, redis.Nil) {
		// Redis е проблем, но не и причина да откажем заявката: продължаваме към базата.
		slog.WarnContext(ctx, "cache get failed", "err", err)
	}

	p, err := c.store.Get(ctx, id)
	if err != nil {
		return Product{}, err
	}
	if b, err := json.Marshal(p); err == nil {
		if err := c.rdb.Set(ctx, productKey(id), b, productTTL).Err(); err != nil {
			slog.WarnContext(ctx, "cache set failed", "err", err)
		}
	}
	return p, nil
}
```

## 4. Инвалидация при промяна

След успешен запис в базата изтриваш ключа. Следващото четене ще го зареди наново. Изтриването е по-безопасно от презаписване, защото не рискуваш да сложиш в кеша стара стойност от паралелна заявка.

```go internal/product/cache.go
func (c *CachedStore) Update(ctx context.Context, p Product) error {
	if err := c.store.Update(ctx, p); err != nil {
		return err
	}
	return c.rdb.Del(ctx, productKey(p.ID)).Err()
}
```

Ако продуктът се променя в транзакция, викай `Del` след commit, не вътре в нея.

## 5. Брояч за rate limiting

Fixed window: ключ за потребител и минута, `Incr` го увеличава атомарно, а `Expire` се слага само при първото увеличение, за да изчезне ключът сам.

```go internal/httpx/ratelimit.go
package httpx

import (
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

func RateLimit(rdb *redis.Client, limit int64, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			window := time.Now().Unix() / 60
			key := fmt.Sprintf("rl:%s:%d", keyFn(r), window)

			n, err := rdb.Incr(ctx, key).Result()
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			if n == 1 {
				rdb.Expire(ctx, key, time.Minute)
			}
			if n > limit {
				w.Header().Set("Retry-After", "60")
				WriteProblem(w, r, http.StatusTooManyRequests, "too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

При грешка в Redis пропускаме заявката (fail open), за да не свали падането на Redis целия API. За login endpoint-и може да решиш обратното.

## 6. Капани

- Винаги слагай TTL на кеш ключовете. Ключ без TTL остава завинаги, а при грешка в инвалидацията данните са стари завинаги.
- `redis.Nil` не е грешка за логване. Проверявай го с `errors.Is` и го третирай като cache miss.
- Не кеширай данни на конкретен потребител под ключ без потребителското id, иначе ще ги покажеш на някой друг.
- Кешът е оптимизация. Сървисът трябва да работи, макар и по-бавно, когато Redis е недостъпен.
- Префиксвай ключовете (`product:`, `rl:`), за да можеш да ги намериш и изтриеш по група.

## 7. Свързани документи

- [Middleware](Middleware.md)
- [Sessions и cookies](Sessions.md)
- [PostgreSQL с pgx](Postgres_pgx.md)
- [Конфигурация](Configuration.md)
- [Graceful shutdown](Graceful_Shutdown.md)
