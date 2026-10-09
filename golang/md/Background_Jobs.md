# Background jobs

Background job е работа, която не трябва да блокира HTTP заявката: имейл след поръчка, генериране на фактура, извикване на бавно външно API. Ползваме River, защото опашката живее в същия PostgreSQL и job-ът се записва в същата транзакция като поръчката, така че няма поръчка без имейл и имейл без поръчка.

## 1. Инсталация

Библиотеката, pgx драйверът и CLI-то за миграции.

```bash
go get github.com/riverqueue/river@latest
go get github.com/riverqueue/river/riverdriver/riverpgxv5@latest
go install github.com/riverqueue/river/cmd/river@latest
```

River има собствени таблици (`river_job`, `river_queue` и др.). Пусни миграциите му веднъж на всяка среда, отделно от твоите golang-migrate миграции:

```bash
river migrate-up --database-url "$DB_URL"
```

## 2. Минимален пример

Един job има два типа: аргументи с уникален `Kind()` и worker, който ги обработва. Аргументите се сериализират в JSON, затова пази в тях само ID-та, не цели обекти.

```go internal/jobs/send_order_email.go
package jobs

import (
	"context"
	"fmt"

	"github.com/riverqueue/river"
)

type SendOrderEmailArgs struct {
	OrderID int64 `json:"order_id"`
}

func (SendOrderEmailArgs) Kind() string { return "send_order_email" }

type OrderMailer interface {
	SendOrderConfirmation(ctx context.Context, orderID int64) error
}

type SendOrderEmailWorker struct {
	river.WorkerDefaults[SendOrderEmailArgs]
	Mailer OrderMailer
}

func (w *SendOrderEmailWorker) Work(ctx context.Context, job *river.Job[SendOrderEmailArgs]) error {
	if err := w.Mailer.SendOrderConfirmation(ctx, job.Args.OrderID); err != nil {
		return fmt.Errorf("send confirmation for order %d: %w", job.Args.OrderID, err)
	}
	return nil
}
```

Worker процесът регистрира worker-ите, стартира клиента и го спира при SIGTERM.

```go cmd/worker/main.go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/acme/shop/internal/config"
	"github.com/acme/shop/internal/db"
	"github.com/acme/shop/internal/jobs"
	"github.com/acme/shop/internal/order"
	"github.com/acme/shop/internal/platform/mail"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	pool, err := db.New(ctx, cfg.DB.URL)
	if err != nil {
		slog.Error("db", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	mailer, err := mail.NewMailer(cfg.Mail)
	if err != nil {
		slog.Error("mailer", "err", err)
		os.Exit(1)
	}
	workers := river.NewWorkers()
	river.AddWorker(workers, &jobs.SendOrderEmailWorker{Mailer: order.NewNotifier(order.NewStore(pool), mailer)})

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:  map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 20}},
		Workers: workers,
	})
	if err != nil {
		slog.Error("river", "err", err)
		os.Exit(1)
	}
	if err := client.Start(ctx); err != nil {
		slog.Error("river start", "err", err)
		os.Exit(1)
	}

	<-ctx.Done()
	// Stop изчаква текущите job-ове; нов context, защото ctx вече е отменен.
	stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := client.Stop(stopCtx); err != nil {
		slog.Warn("river stop", "err", err)
	}
}
```

## 3. Enqueue в същата транзакция

API процесът създава insert-only клиент: същия `river.NewClient`, но без `Queues` и `Workers`. Той само записва job-ове и никога не ги изпълнява.

```go cmd/api/main.go
riverClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
```

В service слоя job-ът се записва с `InsertTx` в същата pgx транзакция като поръчката. Ако commit-ът падне, job-ът изчезва заедно с поръчката; ако мине, worker-ът го вижда веднага.

```go internal/order/service.go
func (s *Service) Create(ctx context.Context, in CreateOrderInput) (Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)

	o, err := s.store.WithTx(tx).CreateOrder(ctx, in)
	if err != nil {
		return Order{}, err
	}

	if _, err := s.river.InsertTx(ctx, tx, jobs.SendOrderEmailArgs{OrderID: o.ID}, nil); err != nil {
		return Order{}, fmt.Errorf("enqueue email: %w", err)
	}

	return o, tx.Commit(ctx)
}
```

Полето `river` в `Service` е `*river.Client[pgx.Tx]`. Последният аргумент е `*river.InsertOpts`, в него задаваш `Queue`, `MaxAttempts` или `ScheduledAt` за отложено изпълнение.

## 4. Retries

Когато `Work` върне грешка, River повтаря job-а автоматично с експоненциален backoff и jitter, по подразбиране до 25 опита, след което го маркира като `discarded`. Ако грешката е окончателна (поръчката е изтрита), върни `river.JobCancel(err)` и River няма да опитва отново.

## 5. Капани

- Job-ът се изпълнява поне веднъж, не точно веднъж: worker-ът може да умре след изпращането на имейла и преди River да отбележи успеха. Направи `Work` идемпотентен.
- `Insert` извън транзакцията на поръчката връща проблема, който River решава. Винаги `InsertTx` с `tx`, когато има свързан запис.
- Не пускай worker-и в `cmd/api`. API-то държи само insert-only клиент, обработката е в `cmd/worker`.
- Забравен `river migrate-up` след ъпгрейд на River дава грешки за липсващи колони при старт. Сложи го в deploy pipeline-а.
- Аргументите са JSON в базата. Преименуване на поле или на `Kind()` чупи вече записаните job-ове.

## 6. Свързани документи

- [Транзакции](Transactions.md)
- [Cron задачи](Cron.md)
- [Имейли и шаблони](Emails_Templates.md)
- [PostgreSQL с pgx](Postgres_pgx.md)
- [Graceful shutdown](Graceful_Shutdown.md)
