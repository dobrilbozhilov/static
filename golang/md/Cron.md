# Cron задачи

Cron задачите са периодична работа по разписание: нощно почистване на изоставени колички, ежечасен отчет, синхронизация с външна система. Ползваме `robfig/cron/v3`, защото е стандартът в Go екосистемата, поддържа класическия 5-полев синтаксис и спира чисто, като изчаква текущите задачи.

## 1. Инсталация

Библиотеката е една, без зависимости.

```bash
go get github.com/robfig/cron/v3@latest
```

## 2. Минимален пример

Cron живее в `cmd/worker/main.go`, не в API процеса. API-то се скалира според трафика и ако всяка реплика пуска cron, задачите ще тръгват по N пъти; освен това deploy на API не трябва да прекъсва нощна задача.

```go cmd/worker/main.go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/acme/shop/internal/config"
	"github.com/acme/shop/internal/logging"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	logger := logging.New(cfg.Env, cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Явно UTC, иначе разписанието зависи от часовата зона на контейнера.
	c := cron.New(cron.WithLocation(time.UTC))

	if _, err := c.AddFunc("0 3 * * *", job(logger, "cleanup-carts", cleanupCarts)); err != nil {
		logger.Error("add job", "err", err)
		os.Exit(1)
	}
	if _, err := c.AddFunc("@every 5m", job(logger, "sync-stock", syncStock)); err != nil {
		logger.Error("add job", "err", err)
		os.Exit(1)
	}

	c.Start()
	logger.Info("cron started")

	<-ctx.Done()
	logger.Info("stopping cron, waiting for running jobs")

	// Stop не пуска нови задачи; върнатият context се затваря, когато текущите приключат.
	select {
	case <-c.Stop().Done():
	case <-time.After(30 * time.Second):
		logger.Warn("cron jobs did not finish in time")
	}
}

func cleanupCarts(ctx context.Context) error { return nil }
func syncStock(ctx context.Context) error    { return nil }
```

## 3. Изрази за разписание

По подразбиране парсерът е стандартният 5-полев: минута, час, ден от месеца, месец, ден от седмицата.

| Израз | Кога |
| --- | --- |
| `0 3 * * *` | всеки ден в 03:00 |
| `*/15 * * * *` | на всеки 15 минути, на кръгли четвъртинки |
| `0 9 * * 1` | всеки понеделник в 09:00 |
| `@every 5m` | на 5 минути от старта на процеса |

`@every` брои от момента на `c.Start()`, а не от кръгъл час. Ако ти трябва точен час, ползвай класически израз.

## 4. Recover, логване и timeout

В v3 `cron.New()` не лови panic по подразбиране, така че panic в задача сваля целия worker, а върнатите грешки не се логват никъде. Обвий всяка задача в малък helper, който дава context с timeout, лови panic и логва резултата.

```go cmd/worker/jobs.go
package main

import (
	"context"
	"log/slog"
	"time"
)

func job(logger *slog.Logger, name string, fn func(context.Context) error) func() {
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		start := time.Now()
		defer func() {
			if r := recover(); r != nil {
				logger.Error("cron job panic", "job", name, "panic", r)
			}
		}()

		if err := fn(ctx); err != nil {
			logger.Error("cron job failed", "job", name, "err", err, "duration", time.Since(start))
			return
		}
		logger.Info("cron job done", "job", name, "duration", time.Since(start))
	}
}
```

## 5. Няколко реплики: advisory lock

Ако worker-ът върви в 2 или повече реплики, всяка ще пусне задачата. Вземи Postgres advisory lock вътре в задачата: само една реплика го получава, останалите пропускат този цикъл. Lock-ът е на ниво сесия, затова трябва да го вземеш и освободиш на една и съща връзка от pool-а.

```go cmd/worker/lock.go
package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const lockCleanupCarts int64 = 1001

func withLock(ctx context.Context, pool *pgxpool.Pool, key int64, fn func(context.Context) error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire conn: %w", err)
	}
	defer conn.Release()

	var ok bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&ok); err != nil {
		return fmt.Errorf("try lock: %w", err)
	}
	if !ok {
		return nil // друга реплика вече я изпълнява
	}
	// WithoutCancel: освобождаваме lock-а дори ако ctx е изтекъл.
	defer conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", key)

	return fn(ctx)
}
```

Регистрацията става `job(logger, "cleanup-carts", func(ctx context.Context) error { return withLock(ctx, pool, lockCleanupCarts, cleanupCarts) })`.

## 6. Капани

- Не пускай cron в `cmd/api`. При 3 реплики на API нощният имейл ще излезе 3 пъти.
- Без `cron.WithLocation(time.UTC)` разписанието следва `TZ` на контейнера, а лятното часово време прескача или повтаря часове.
- `@every 5m` не изчаква предишното изпълнение да приключи. Ако задачата може да е по-бавна от интервала, ползвай advisory lock или `cron.WithChain(cron.SkipIfStillRunning(...))`.
- `pg_try_advisory_lock` през `pool.Exec` без `Acquire` взима lock на случайна връзка и unlock-ът може да отиде на друга. Lock-ът остава висящ до затваряне на връзката.
- Cron не е опашка: ако процесът е спрял в 03:00, задачата просто се пропуска. За работа, която трябва да се изпълни гарантирано, ползвай [Background jobs](Background_Jobs.md).

## 7. Свързани документи

- [Background jobs](Background_Jobs.md)
- [Graceful shutdown](Graceful_Shutdown.md)
- [Транзакции](Transactions.md)
- [Logging със slog](Logging.md)
- [Структура на проекта](Project_Structure.md)
