# JSON и DTO

DTO са отделни request и response structs, които описват договора на API-то, независимо от domain модела и базата. Ползваме само `encoding/json` от стандартната библиотека, с struct tags и ръчни функции за мапване.

## 1. Минимален пример

Domain моделът в `model.go` няма `json` tags и не знае за HTTP. Request и response structs стоят до handler-ите.

```go internal/order/model.go
package order

import "time"

type Order struct {
	ID              int64
	UserID          int64
	Status          Status
	TotalCents      int64
	Currency        string
	Note            string
	ShippingAddress string
	Items           []Item
	CreatedAt       time.Time
}

type Item struct {
	ProductID  int64
	Quantity   int
	PriceCents int64
}
```

```go internal/order/handler.go
type OrderResponse struct {
	ID         int64          `json:"id"`
	Status     string         `json:"status"`
	TotalCents int64          `json:"total_cents"`
	Currency   string         `json:"currency"`
	Note       string         `json:"note,omitempty"`
	Items      []ItemResponse `json:"items"`
	CreatedAt  time.Time      `json:"created_at"`
}

type ItemResponse struct {
	ProductID  int64 `json:"product_id"`
	Quantity   int   `json:"quantity"`
	PriceCents int64 `json:"price_cents"`
}

func toOrderResponse(o Order) OrderResponse {
	items := make([]ItemResponse, 0, len(o.Items))
	for _, it := range o.Items {
		items = append(items, ItemResponse{
			ProductID:  it.ProductID,
			Quantity:   it.Quantity,
			PriceCents: it.PriceCents,
		})
	}
	return OrderResponse{
		ID:         o.ID,
		Status:     string(o.Status),
		TotalCents: o.TotalCents,
		Currency:   o.Currency,
		Note:       o.Note,
		Items:      items,
		CreatedAt:  o.CreatedAt.UTC(),
	}
}
```

```json
{
  "id": 1042,
  "status": "pending",
  "total_cents": 4598,
  "currency": "EUR",
  "items": [{ "product_id": 7, "quantity": 2, "price_cents": 2299 }],
  "created_at": "2026-10-09T08:15:30Z"
}
```

`time.Time` се сериализира като RFC 3339 автоматично. `.UTC()` дава `Z` вместо отместването на сървъра.

## 2. Request DTO и tags

`omitempty` пропуска полето при нулева стойност. `json:"-"` изключва полето от JSON изцяло: тук `UserID` идва от token-а, а не от тялото, и клиентът не може да го подмени.

```go internal/order/handler.go
type CreateOrderRequest struct {
	Items  []CreateItemRequest `json:"items"`
	Note   string              `json:"note,omitempty"`
	UserID int64               `json:"-"`
}

type CreateItemRequest struct {
	ProductID int64 `json:"product_id"`
	Quantity  int   `json:"quantity"`
}

func (r CreateOrderRequest) toInput() CreateOrderInput {
	items := make([]CreateItemInput, 0, len(r.Items))
	for _, it := range r.Items {
		items = append(items, CreateItemInput{ProductID: it.ProductID, Quantity: it.Quantity})
	}
	return CreateOrderInput{UserID: r.UserID, Note: r.Note, Items: items}
}
```

Цената не идва от клиента. Service-ът я взима от продуктите, затова `CreateItemRequest` няма `price_cents`.

## 3. Пари като int64 cents

Пари никога не са `float64`: `0.1 + 0.2` не е `0.3` и сумите на поръчки се разминават с центове. Пази ги като цяло число в най-малката единица плюс валута.

```go internal/order/service.go
func total(items []Item) int64 {
	var sum int64
	for _, it := range items {
		sum += it.PriceCents * int64(it.Quantity)
	}
	return sum
}
```

Фронтендът показва `4598` като `45,98 €`. В Postgres колоната е `bigint`, а не `numeric` или `real`.

## 4. Pointer полета за PATCH

При PATCH трябва да различиш "полето не е пратено" от "пратено е празно". Pointer е `nil`, когато ключът липсва в JSON-а.

```go internal/order/handler.go
type UpdateOrderRequest struct {
	Note            *string `json:"note"`
	ShippingAddress *string `json:"shipping_address"`
}

func (r UpdateOrderRequest) toInput() UpdateOrderInput {
	return UpdateOrderInput{Note: r.Note, ShippingAddress: r.ShippingAddress}
}
```

```go internal/order/service.go
if in.Note != nil {
	o.Note = *in.Note
}
if in.ShippingAddress != nil {
	o.ShippingAddress = *in.ShippingAddress
}
```

`{"note": ""}` изчиства бележката, а `{}` не пипа нищо.

## 5. Капани

- `nil` slice се сериализира като `null`, а не `[]`. Създавай го с `make(..., 0, n)`, както в `toOrderResponse`.
- Неекспортирани полета (с малка буква) се игнорират мълчаливо от `encoding/json`, без грешка.
- `json:"note"` на pointer не различава `{"note": null}` от липсващ ключ, и двете дават `nil`. Ако ти трябва null като "изтрий", ползвай отделно поле или JSON Merge Patch.
- Без `DisallowUnknownFields` грешно изписан ключ като `"qty"` се игнорира и клиентът не разбира защо стойността не се записва. Виж `httpx.Decode` в [Handlers](Handlers.md).
- JavaScript губи точност над 2^53. Ако ID-тата ти са snowflake или random `int64`, сериализирай ги като низ с `json:"id,string"`.

## 6. Свързани документи

- [Handlers](Handlers.md)
- [Валидации](Validation.md)
- [sqlc вместо ORM](SQLC.md)
- [API документация](API_Docs.md)
