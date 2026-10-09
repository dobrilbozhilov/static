# Logging със slog

Стандартният пакет `log/slog` дава структурирани логове с нива, атрибути и сменяем handler, без външна библиотека. Ползваш го от първия ден: JSON в production, за да ги чете Loki или ELK, и четим текст локално.

## 1. Минимален пример

Един конструктор решава формата и нивото според конфигурацията.

```go internal/logging/logging.go
package logging

import (
	"log/slog"
	"os"
	"strings"
)

func New(env, level string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var h slog.Handler
	if env == "production" {
		h = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		h = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(h)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
```

Нивото и средата идват от конфигурацията (виж [Конфигурация](Configuration.md)):

```go internal/config/config.go
type Config struct {
	Env      string `env:"APP_ENV" envDefault:"local"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	// ...
}
```

```go cmd/api/main.go
func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load config", slog.Any("err", err))
		os.Exit(1)
	}

	logger := logging.New(cfg.Env, cfg.LogLevel)
	// slog.Info и log.Printf от чужди библиотеки отиват през същия handler
	slog.SetDefault(logger)

	logger.Info("starting api", slog.String("env", cfg.Env), slog.String("addr", cfg.HTTP.Addr))
}
```

## 2. Структурирани атрибути

Пиши събитие като кратко съобщение плюс атрибути, не като форматиран низ. Типизираните конструктори (`slog.String`, `slog.Int64`) не алокират излишно и не объркват ключ със стойност.

```go internal/order/service.go
func (s *Service) Place(ctx context.Context, userID int64, in PlaceInput) (Order, error) {
	log := logging.FromContext(ctx)

	o, err := s.store.Create(ctx, userID, in)
	if err != nil {
		log.Error("create order", slog.Int64("user_id", userID), slog.Any("err", err))
		return Order{}, err
	}

	log.Info("order placed",
		slog.Int64("order_id", o.ID),
		slog.Int64("total_cents", o.TotalCents),
		slog.Int("items", len(in.Items)),
	)
	return o, nil
}
```

В JSON това излиза като един ред:

```json
{"time":"2026-10-09T10:12:03Z","level":"INFO","msg":"order placed","request_id":"c1f...","user_id":42,"order_id":981,"total_cents":4599,"items":3}
```

Групирай свързани полета с `slog.Group("http", slog.String("method", ...), ...)`, когато са много.

## 3. Logger в context с request_id и user_id

Middleware създава logger с `request_id` и го слага в context. След Authenticate добавяш и `user_id`. Така всеки ред от една заявка носи едни и същи полета.

```go internal/logging/logging.go
type ctxKey struct{}

func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxKey{}, l)
}

func FromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(ctxKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}
```

```go internal/httpx/middleware.go
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		l := slog.Default().With(slog.String("request_id", middleware.GetReqID(r.Context())))
		ctx := logging.WithLogger(r.Context(), l)

		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r.WithContext(ctx))

		l.Info("http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", ww.Status()),
			slog.Duration("duration", time.Since(start)),
		)
	})
}
```

```go internal/auth/middleware.go
// след проверка на token-а и ResolveUser, u е auth.User
ctx = logging.WithLogger(ctx, logging.FromContext(ctx).With(slog.Int64("user_id", u.ID)))
```

Редът на middleware е в [Middleware](Middleware.md): `RequestID` преди `RequestLogger`, `Authenticate` след тях.

## 4. Какво никога не логваш

Не логвай `Authorization` header, access и refresh token-и, пароли, cookie стойности, номера на карти и цели request body-та. Ако тип носи тайна, имплементирай `slog.LogValuer`, за да е безопасен дори при грешка:

```go internal/config/config.go
type Secret string

func (Secret) LogValue() slog.Value { return slog.StringValue("[REDACTED]") }
```

```go internal/config/config.go
type DB struct {
	URL      Secret `env:"URL,required"` // DB_URL през envPrefix
	MaxConns int32  `env:"MAX_CONNS" envDefault:"10"`
}
```

Сега `slog.Any("cfg", cfg)` никога не изкарва паролата от connection string-а.

## 5. Капани

- `slog.Info("msg", "user_id")` с нечетен брой аргументи не гърми, а пише `!BADKEY`. Ползвай типизираните конструктори или включи `go vet`, който хваща това.
- Логване на грешка и връщането ѝ нагоре води до един и същ ред пет пъти. Логвай там, където грешката се обработва, обикновено в handler-а или в `httpx`.
- Не създавай нов handler за всяка заявка. `logger.With(...)` е евтин и споделя същия handler.
- Ниво `debug` в production пълни диска и бюджета за логове. Сменяй нивото през `LOG_LEVEL` и рестарт, не с код.
- Висока кардиналност в `msg` (ID-та в текста) прави търсенето трудно. Съобщението е константа, променливите са атрибути.

## 6. Свързани документи

- [Middleware](Middleware.md)
- [Context](Context.md)
- [Конфигурация](Configuration.md)
- [Метрики и tracing](Observability.md)
- [Грешки](Errors.md)
