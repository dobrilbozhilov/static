# Routing с chi

Router-ът свързва HTTP метод и път с handler и групира routes с общи middleware. Ползваме `chi`, защото е изцяло съвместим с `net/http`, няма собствен context тип и е де факто стандартът за REST API в Go.

## 1. Инсталация

`chi` няма външни зависимости, `middleware` подпакетът идва със същия модул.

```bash
go get github.com/go-chi/chi/v5@latest
```

## 2. Минимален пример

`chi.NewRouter()` връща `*chi.Mux`, който е `http.Handler` и се подава директно на `http.Server`. Параметрите в пътя се дефинират с `{name}` и се четат с `chi.URLParam`.

```go internal/server/routes.go
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func Routes() http.Handler {
	r := chi.NewRouter()

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Get("/orders/{orderID}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "orderID")
		w.Write([]byte("order " + id))
	})

	r.Post("/orders", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})

	return r
}
```

Можеш да ограничиш параметъра с regexp: `{orderID:[0-9]+}`. Заявка `/orders/abc` тогава получава 404, без да стига до handler-а.

## 3. Route и Group

`r.Route` създава под-router с общ префикс. `r.Group` не добавя префикс, а само отделя група routes със собствени middleware, например такива, които искат login.

```go internal/server/routes.go
r.Route("/api/v1", func(r chi.Router) {
	r.Get("/products", products.List)
	r.Get("/products/{productID}", products.Get)

	r.Group(func(r chi.Router) {
		r.Use(authn.Authenticate)
		r.Post("/orders", orders.Create)
		r.Get("/orders/{orderID}", orders.Get)
	})
})
```

Middleware, добавени с `r.Use` в група, важат само за routes в нея. Публичните `/products` не минават през `Authenticate`.

## 4. Mount на feature router

Всеки feature пакет сам описва своите routes в метод `Routes()`. Централният `routes.go` само ги mount-ва под префикс, така добавянето на endpoint не пипа общия файл.

```go internal/order/handler.go
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{orderID}", h.Get)
	r.Patch("/{orderID}", h.Update)
	r.Delete("/{orderID}", h.Delete)
	return r
}
```

```go internal/server/routes.go
package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/acme/shop/internal/httpx"
	"github.com/acme/shop/internal/order"
)

func Routes(orders *order.Handler) http.Handler {
	r := chi.NewRouter()

	// Подробности и собствени middleware: Middleware.md
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Recoverer, middleware.Timeout(30*time.Second))

	r.NotFound(notFound)
	r.MethodNotAllowed(methodNotAllowed)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Mount("/api/v1/orders", orders.Routes())

	return r
}
```

`GET /api/v1/orders/42` стига до `h.Get`, а `chi.URLParam(r, "orderID")` връща `"42"` и в mount-натия router.

## 5. 404 и 405

По подразбиране chi връща plain text. Замени ги, за да отговаря API-то винаги с `application/problem+json`.

```go internal/server/routes.go
func notFound(w http.ResponseWriter, r *http.Request) {
	httpx.WriteProblem(w, r, http.StatusNotFound, "route not found")
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	httpx.WriteProblem(w, r, http.StatusMethodNotAllowed, "method not allowed")
}
```

С custom handler chi вече не слага `Allow` header на 405, добави го сам, ако клиентите ти разчитат на него. Самият `httpx.WriteProblem` е описан в [Грешки](Errors.md).

## 6. Капани

- `r.Use` трябва да е преди всички routes в router-а, иначе chi panic-ва с `all middlewares must be defined before routes on a mux`.
- `chi.URLParam` връща празен низ, ако името не съвпада с това в шаблона. Дръж имената еднакви, `orderID` навсякъде.
- Два `r.Mount` на един и същ префикс водят до panic при старт. Всеки feature има собствен префикс.
- Не парсвай `r.URL.Path` ръчно за параметри. Всичко, което е в шаблона, четеш с `chi.URLParam`.

## 7. Свързани документи

- [Handlers](Handlers.md)
- [Middleware](Middleware.md)
- [Грешки](Errors.md)
- [Authentication](Authentication.md)
- [Структура на проекта](Project_Structure.md)
