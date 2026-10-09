# Middleware

Middleware е функция, която обвива `http.Handler` и прави нещо преди или след него: request ID, logging, recover от panic, timeout, CORS, authentication. Ползваме вградените middleware на `chi` плюс собствени със същата форма, а за CORS само `go-chi/cors`.

## 1. Инсталация

`middleware` подпакетът идва с `chi`, CORS е отделен модул.

```bash
go get github.com/go-chi/chi/v5@latest
go get github.com/go-chi/cors@latest
```

## 2. Минимален пример

Всеки middleware има формата `func(http.Handler) http.Handler`. Кодът преди `next.ServeHTTP` се изпълнява на път навътре, кодът след него на път навън.

```go internal/httpx/middleware.go
package httpx

import "net/http"

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
```

chi вече има готовите, които са ти нужни почти винаги:

```go internal/server/routes.go
r := chi.NewRouter()
r.Use(middleware.RequestID)                 // X-Request-Id, ако клиентът не е пратил
r.Use(middleware.RealIP)                    // r.RemoteAddr от X-Forwarded-For
r.Use(httpx.RequestLogger)
r.Use(middleware.Recoverer)                 // panic става 500, сървърът не пада
r.Use(middleware.Timeout(30 * time.Second)) // отменя r.Context() след 30s
r.Use(httpx.SecurityHeaders)
```

## 3. Собствен logging middleware

За да логнеш статуса, трябва да обвиеш `ResponseWriter`. `middleware.NewWrapResponseWriter` прави точно това и пази статуса и броя байтове.

```go internal/httpx/middleware.go
package httpx

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}
		level := slog.LevelInfo
		if status >= 500 {
			level = slog.LevelError
		}
		slog.LogAttrs(r.Context(), level, "http request",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", status),
			slog.Int("bytes", ww.BytesWritten()),
			slog.Duration("duration", time.Since(start)),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		)
	})
}
```

`RequestLogger` стои преди `Recoverer`, затова при panic вижда вече записания 500 и го логва като грешка.

## 4. CORS

CORS ти трябва само ако браузър от друг origin вика API-то директно. Сложи го високо в стека, за да отговаря на preflight `OPTIONS` преди authentication.

```go internal/server/routes.go
r.Use(cors.Handler(cors.Options{
	AllowedOrigins:   cfg.HTTP.CORSOrigins, // HTTP_CORS_ORIGINS=https://shop.acme.com,http://localhost:5173
	AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
	AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-Id"},
	ExposedHeaders:   []string{"Location"},
	AllowCredentials: true,
	MaxAge:           300,
}))
```

Origins идват от `HTTP_CORS_ORIGINS`, а не са hardcode-нати, виж [Конфигурация](Configuration.md).

## 5. Ред на middleware

Middleware се изпълняват в реда на `r.Use`. Заявката минава навътре до handler-а, а отговорът се връща през същите слоеве в обратен ред.

```mermaid
flowchart LR
  client("Клиент") -->|"заявка"| reqid("RequestID и RealIP")
  reqid -->|"с request id"| logger("RequestLogger")
  logger -->|"обвит writer"| recoverer("Recoverer")
  recoverer -->|"защитено от panic"| cors("CORS и Timeout")
  cors -->|"context с deadline"| auth("Authenticate")
  auth -->|"user в context"| handler("order.Handler")
```

Правилото: `RequestID` пръв, за да го има в логовете; logger преди `Recoverer`; CORS преди auth; auth само в групите, които го искат, с `r.Group`.

## 6. Капани

- `r.Use` след регистриран route в същия router предизвиква panic. Всички `Use` са в началото.
- `middleware.Timeout` само отменя context-а. Ако handler-ът не подава `r.Context()` надолу, заявката към базата продължава.
- Не поставяй `middleware.Logger` и собствения logger едновременно, получаваш двойни редове в различен формат.
- `AllowedOrigins: []string{"*"}` с `AllowCredentials: true` не работи в браузъра. Изброй origins изрично.
- Middleware, който чете `r.Body`, трябва да го върне обратно, иначе handler-ът получава празно тяло.

## 7. Свързани документи

- [Routing с chi](Routing.md)
- [Logging със slog](Logging.md)
- [Authentication](Authentication.md)
- [Context](Context.md)
- [Метрики и tracing](Observability.md)
