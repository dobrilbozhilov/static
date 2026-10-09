# API документация

Пишеш първо OpenAPI спецификацията в `api/openapi.yaml`, а от нея генерираш Go типовете и chi сървъра с `oapi-codegen`. Спецификацията е договорът: фронтендът генерира клиента си от нея, а компилаторът ти казва, ако handler-ите не отговарят.

## 1. Инсталация

От Go 1.24 инструментите се записват в `go.mod` като `tool` и се пускат с `go tool`.

```bash
go get -tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
```

## 2. Минимален пример

Спецификация с един path:

```yaml api/openapi.yaml
openapi: 3.0.3
info:
  title: Shop API
  version: 1.0.0
servers:
  - url: /api
paths:
  /orders/{orderID}:
    get:
      operationId: getOrder
      parameters:
        - name: orderID
          in: path
          required: true
          schema: { type: integer, format: int64 }
      responses:
        "200":
          description: Order
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "404":
          description: Not found
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Problem" }
components:
  schemas:
    Order:
      type: object
      required: [id, status, total_cents]
      properties:
        id: { type: integer, format: int64 }
        status: { type: string }
        total_cents: { type: integer, format: int64 }
    Problem:
      type: object
      required: [title, status]
      properties:
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
```

Конфигурация на генератора:

```yaml api/oapi-codegen.yaml
package: api
# пътят е спрямо директорията с go:generate, т.е. internal/api/api.gen.go
output: api.gen.go
generate:
  chi-server: true
  models: true
  strict-server: true
```

```go internal/api/generate.go
package api

//go:generate go tool oapi-codegen -config ../../api/oapi-codegen.yaml ../../api/openapi.yaml
```

```bash
go generate ./internal/api/
```

Генерираният `internal/api/api.gen.go` не се редактира. Комитваш го, за да се билдва без генератор.

## 3. Имплементация на StrictServerInterface

Strict сървърът декодира параметрите и body-то вместо теб и ти дава типизирани request и response обекти. Адаптерът вика service-а от домейна:

```go internal/api/server.go
package api

import (
	"context"
	"errors"

	"github.com/acme/shop/internal/order"
)

type Server struct {
	orders *order.Service
}

func NewServer(orders *order.Service) *Server { return &Server{orders: orders} }

var _ StrictServerInterface = (*Server)(nil)

func (s *Server) GetOrder(ctx context.Context, req GetOrderRequestObject) (GetOrderResponseObject, error) {
	o, err := s.orders.Get(ctx, req.OrderID)
	if errors.Is(err, order.ErrNotFound) {
		return GetOrder404JSONResponse{Title: "Order not found", Status: 404}, nil
	}
	if err != nil {
		return nil, err
	}
	return GetOrder200JSONResponse{Id: o.ID, Status: string(o.Status), TotalCents: o.TotalCents}, nil
}
```

`var _ StrictServerInterface = ...` чупи билда веднага, щом добавиш операция в спецификацията и не я имплементираш.

Монтиране в router-а:

```go internal/server/routes.go
func Routes(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)

	strict := api.NewStrictHandler(api.NewServer(d.Orders), nil)
	r.Route("/api", func(r chi.Router) {
		r.Use(auth.Authenticate(d.Verifier, d.Users))
		api.HandlerFromMux(strict, r)
	})

	r.Get("/docs", apispec.DocsHandler)
	r.Get("/docs/openapi.yaml", apispec.SpecHandler)
	return r
}
```

## 4. Swagger UI

`//go:embed` вижда само файлове в своята директория, затова малък пакет в `api/` вгражда спецификацията и една HTML страница.

```html api/docs.html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shop API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/docs/openapi.yaml", dom_id: "#swagger" });</script>
</body>
</html>
```

```go api/spec.go
package apispec

import (
	_ "embed"
	"net/http"
)

//go:embed openapi.yaml
var spec []byte

//go:embed docs.html
var docs []byte

func SpecHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	w.Write(spec)
}

func DocsHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(docs)
}
```

Фронтендът генерира TypeScript типовете от същия файл (виж [Backend и фронтенд](Frontend_Backend.md)).

## 5. Капани

- Промяна на кода без промяна на спецификацията обезсмисля подхода. Всяка промяна на API-то започва от `openapi.yaml` и `go generate`.
- Генерираният файл трябва да е актуален. В CI пусни `go generate ./...` и `git diff --exit-code`, за да хванеш забравено генериране.
- Strict handler-ът връща 500 с текста на грешката, ако върнеш `error`. Ползвай `api.NewStrictHandlerWithOptions` със собствен `ResponseErrorHandlerFunc` в `StrictHTTPServerOptions`, за да връщаш problem+json (виж [Грешки](Errors.md)).
- Валидацията по схемата не става автоматично. Бизнес правилата остават в service-а (виж [Валидации](Validation.md)).
- Премахване или преименуване на поле чупи фронтенда. Добавяй нови полета, а старите маркирай `deprecated: true`.

## 6. Свързани документи

- [Backend и фронтенд](Frontend_Backend.md)
- [Routing с chi](Routing.md)
- [JSON и DTO](JSON_DTO.md)
- [Грешки](Errors.md)
- [Go modules и инструменти](Modules_Tooling.md)
