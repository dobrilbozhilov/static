# Имейли и шаблони

Транзакционните имейли (потвърждение на поръчка, reset линк) се рендерират с `html/template` от шаблони, вградени в binary-то с `embed`, и се пращат по SMTP. Пращането винаги е в background job, никога директно в handler-а, защото SMTP е бавен и понякога пада.

## 1. Инсталация

Ползваме `go-mail`, защото е активно поддържан, без зависимости и поддържа context, TLS политики и SMTP auth.

```bash
go get github.com/wneessen/go-mail@latest
```

Локално имейлите отиват в Mailpit: SMTP на 1025, UI на `http://localhost:8025`.

```yaml compose.yaml
services:
  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"
      - "8025:8025"
```

## 2. Минимален пример

Шаблоните са в `internal/platform/mail/templates/`, до Go файла, който ги вгражда. Пакетът се казва `mail`, затова библиотеката е импортирана като `gomail`.

Настройките идват от `config.Mail` (`MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`):

```go internal/config/config.go
type Mail struct {
	Host     string `env:"HOST" envDefault:"localhost"`
	Port     int    `env:"PORT" envDefault:"1025"`
	Username string `env:"USERNAME"`
	Password string `env:"PASSWORD"`
	From     string `env:"FROM" envDefault:"shop@acme.com"`
}
```

```go internal/platform/mail/mailer.go
package mail

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"html/template"

	gomail "github.com/wneessen/go-mail"

	"github.com/acme/shop/internal/config"
)

//go:embed templates/*.html
var templatesFS embed.FS

var templates = template.Must(template.ParseFS(templatesFS, "templates/*.html"))

type Mailer struct {
	client *gomail.Client
	from   string
}

func NewMailer(cfg config.Mail) (*Mailer, error) {
	opts := []gomail.Option{gomail.WithPort(cfg.Port)}
	if cfg.Username != "" {
		opts = append(opts,
			gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
			gomail.WithUsername(cfg.Username),
			gomail.WithPassword(cfg.Password),
			gomail.WithTLSPolicy(gomail.TLSMandatory),
		)
	} else {
		// Mailpit локално: без auth и без TLS
		opts = append(opts, gomail.WithTLSPolicy(gomail.NoTLS))
	}
	c, err := gomail.NewClient(cfg.Host, opts...)
	if err != nil {
		return nil, fmt.Errorf("mail client: %w", err)
	}
	return &Mailer{client: c, from: cfg.From}, nil
}

func (m *Mailer) Send(ctx context.Context, to, subject, tpl string, data any) error {
	var body bytes.Buffer
	if err := templates.ExecuteTemplate(&body, tpl, data); err != nil {
		return fmt.Errorf("render %s: %w", tpl, err)
	}
	msg := gomail.NewMsg()
	if err := msg.From(m.from); err != nil {
		return err
	}
	if err := msg.To(to); err != nil {
		return err
	}
	msg.Subject(subject)
	msg.SetBodyString(gomail.TypeTextHTML, body.String())
	return m.client.DialAndSendWithContext(ctx, msg)
}
```

Шаблонът е обикновен `html/template`, който escape-ва всичко автоматично.

```html internal/platform/mail/templates/order_confirmation.html
<!doctype html>
<html>
<body style="font-family: sans-serif">
  <h1>Благодарим за поръчката!</h1>
  <p>Поръчка №{{.ID}} е приета и скоро ще бъде изпратена.</p>
  <ul>
    {{range .Items}}<li>{{.Quantity}} x {{.Title}}</li>{{end}}
  </ul>
</body>
</html>
```

## 3. Пращане от background job

Service-ът записва поръчката и в същата транзакция добавя `jobs.SendOrderEmailArgs`. Worker-ът в `cmd/worker` вика `SendOrderConfirmation` и River го повтаря при грешка, виж [Background jobs](Background_Jobs.md). Този метод живее в `order`, защото знае как да зареди поръчката, а `Mailer` остава generic.

```go internal/order/notifier.go
package order

import (
	"context"

	"github.com/acme/shop/internal/platform/mail"
)

type Notifier struct {
	store  *Store
	mailer *mail.Mailer
}

func NewNotifier(store *Store, mailer *mail.Mailer) *Notifier {
	return &Notifier{store: store, mailer: mailer}
}

func (n *Notifier) SendOrderConfirmation(ctx context.Context, orderID int64) error {
	o, err := n.store.GetWithItems(ctx, orderID)
	if err != nil {
		return err
	}
	return n.mailer.Send(ctx, o.Email, "Поръчката ти е приета", "order_confirmation.html", o)
}
```

```go cmd/worker/main.go
mailer, err := mail.NewMailer(cfg.Mail)
if err != nil {
	slog.Error("mailer", "err", err)
	os.Exit(1)
}
river.AddWorker(workers, &jobs.SendOrderEmailWorker{Mailer: order.NewNotifier(orderStore, mailer)})
```

## 4. Капани

- Не пращай имейл в handler-а: SMTP timeout прави заявката бавна, а при грешка поръчката вече е записана и имейлът е изгубен.
- Пускай job-а в същата транзакция като поръчката (`InsertTx`), иначе при rollback клиентът получава имейл за несъществуваща поръчка.
- Подавай на job-а само id, не целия обект. Данните се четат свежи при изпълнение.
- Пиши стиловете inline: Gmail и Outlook игнорират `<style>` и външни CSS файлове.
- Retry може да прати имейла два пъти, ако SMTP е приел съобщението, но връзката е паднала преди отговора. За транзакционни имейли това обикновено е приемливо.

## 5. Свързани документи

- [Background jobs](Background_Jobs.md)
- [Events в процеса](Events.md)
- [Конфигурация](Configuration.md)
- [Транзакции](Transactions.md)
