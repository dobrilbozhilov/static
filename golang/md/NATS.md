# NATS

NATS е лек message broker за съобщения между сървиси: publish/subscribe, балансиране между реплики и request/reply с милисекундна латентност. Ползваме официалния клиент `nats.go`, а когато съобщенията трябва да оцелеят рестарт, добавяме JetStream от същия пакет.

## 1. Инсталация

Клиентът и JetStream API-то са в един модул.

```bash
go get github.com/nats-io/nats.go@latest
```

Локално сървър с включен JetStream:

```yaml compose.yaml
services:
  nats:
    image: nats:2.10
    command: ["-js", "-sd", "/data"]
    ports:
      - "4222:4222"
```

## 2. Минимален пример

Една връзка на процес, създадена в `main` и подавана надолу. `MaxReconnects(-1)` означава безкрайни опити, иначе след рестарт на NATS клиентът се отказва след 60 опита и сървисът остава глух.

```go internal/platform/nats/nats.go
package nats

import (
	"log/slog"

	natsgo "github.com/nats-io/nats.go"
)

func Connect(url, name string) (*natsgo.Conn, error) {
	return natsgo.Connect(url,
		natsgo.Name(name),
		natsgo.MaxReconnects(-1),
		natsgo.DisconnectErrHandler(func(_ *natsgo.Conn, err error) {
			slog.Warn("nats disconnected", "err", err)
		}),
		natsgo.ReconnectHandler(func(c *natsgo.Conn) {
			slog.Info("nats reconnected", "url", c.ConnectedUrl())
		}),
	)
}
```

В `main` я отваряш с `nats.Connect(cfg.NATS.URL, "shop-api")`. Извън `internal/platform/nats` библиотеката се импортира директно като `nats`.

Publish и subscribe с JSON:

```go internal/order/events.go
func publishCreated(nc *nats.Conn, o Order) error {
	data, err := json.Marshal(o)
	if err != nil {
		return err
	}
	return nc.Publish("orders.created", data)
}
```

```go cmd/worker/main.go
sub, err := nc.Subscribe("orders.created", func(m *nats.Msg) {
	var o order.Order
	if err := json.Unmarshal(m.Data, &o); err != nil {
		slog.Error("bad message", "subject", m.Subject, "err", err)
		return
	}
	slog.Info("order created", "id", o.ID)
})
```

При shutdown извикай `nc.Drain()` вместо `nc.Close()`: спира нови съобщения, изчаква handler-ите за вече получените и чак тогава затваря връзката.

## 3. Queue groups и request/reply

С `Subscribe` всяка реплика получава всяко съобщение. С `QueueSubscribe` репликите с еднаква група си поделят съобщенията, всяко отива само при една.

```go cmd/worker/main.go
_, err = nc.QueueSubscribe("orders.created", "notifications", handleOrderCreated)
```

Request/reply е синхронно извикване през broker-а. Сървисът `product` отговаря, `order` пита с timeout:

```go internal/product/nats.go
_, err := nc.QueueSubscribe("product.get", "product", func(m *nats.Msg) {
	p, err := svc.Get(context.Background(), string(m.Data))
	if err != nil {
		m.Respond([]byte(`{"error":"not_found"}`))
		return
	}
	data, _ := json.Marshal(p)
	m.Respond(data)
})
```

```go internal/order/service.go
msg, err := s.nc.Request("product.get", []byte(productID), 2*time.Second)
if err != nil {
	return fmt.Errorf("product.get: %w", err) // nats.ErrTimeout или nats.ErrNoResponders
}
```

NATS е удобен и за fan-out на WebSocket съобщения между инстанции: всяка инстанция се абонира за `ws.>` и праща на своите клиенти.

## 4. JetStream

Core NATS е fire-and-forget: ако consumer-ът не е свързан в момента, съобщението се губи. JetStream пази съобщенията в stream и следи кое е потвърдено от всеки durable consumer.

```go cmd/worker/main.go
js, err := jetstream.New(nc)
if err != nil {
	return err
}

stream, err := js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
	Name:     "ORDERS",
	Subjects: []string{"orders.>"},
})
if err != nil {
	return err
}

cons, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
	Durable:   "notifications",
	AckPolicy: jetstream.AckExplicitPolicy,
})
if err != nil {
	return err
}

cc, err := cons.Consume(func(msg jetstream.Msg) {
	if err := handleOrderCreated(ctx, msg.Data()); err != nil {
		msg.Nak() // ще дойде отново
		return
	}
	msg.Ack()
})
if err != nil {
	return err
}
defer cc.Stop()
```

Пакетът е `github.com/nats-io/nats.go/jetstream`. Producer-ът публикува с `js.Publish(ctx, "orders.created", data)`, който връща грешка, ако stream-ът не е потвърдил записа.

## 5. Капани

- Core `Publish` не гарантира доставка. За събития, които не бива да се губят, ползвай JetStream.
- Забравен `QueueSubscribe` при 3 реплики на worker означава 3 имейла за една поръчка.
- Handler-ите на `Subscribe` за един subscription вървят последователно в една goroutine. Бавен handler задържа всички следващи съобщения.
- `nc.Close()` при shutdown изгубва съобщенията, които още се обработват. Ползвай `nc.Drain()`.
- JetStream доставя поне веднъж; без `Ack` в рамките на `AckWait` съобщението идва отново, така че handler-ът трябва да е идемпотентен.

## 6. Свързани документи

- [Kafka](Kafka.md)
- [WebSockets](WebSockets.md)
- [Graceful shutdown](Graceful_Shutdown.md)
- [Структура на микросървиси](Microservices_Structure.md)
