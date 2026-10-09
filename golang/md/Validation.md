# Валидации

Валидацията проверява входа от клиента, преди да стигне до бизнес логиката: задължителни полета, формат на имейл, граници на числа. Ползваме `go-playground/validator/v10`, защото е де факто стандартът в Go: правилата живеят като tags на request struct-а и една инстанция обслужва целия сървис.

## 1. Инсталация

Добави библиотеката към модула.

```bash
go get github.com/go-playground/validator/v10@latest
```

## 2. Минимален пример

Една споделена инстанция в `httpx`. `validator.Validate` кешира информацията за struct-овете и е безопасен за конкурентна употреба, затова не създаваш нов на всяка заявка.

```go internal/httpx/validate.go
package httpx

import (
	"errors"
	"reflect"
	"regexp"
	"strings"

	"github.com/go-playground/validator/v10"
)

var validate = newValidator()

func newValidator() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())

	// В грешките искаме имената от JSON ("email"), а не от Go ("Email").
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" {
			return ""
		}
		return name
	})

	if err := v.RegisterValidation("sku", validSKU); err != nil {
		panic(err)
	}
	return v
}

// Validate връща nil, *ValidationError или грешка от неправилно описан struct (bug, 500).
func Validate(v any) error {
	err := validate.Struct(v)
	var ve validator.ValidationErrors
	if !errors.As(err, &ve) {
		return err
	}
	fields := make([]FieldError, 0, len(ve))
	for _, fe := range ve {
		fields = append(fields, FieldError{Field: fieldPath(fe), Message: message(fe)})
	}
	return &ValidationError{Fields: fields}
}
```

Request struct-ът описва правилата с tags. `dive` казва на validator-а да влезе във всеки елемент на slice-а.

```go internal/order/handler.go
type CreateOrderRequest struct {
	Email    string             `json:"email" validate:"required,email"`
	Currency string             `json:"currency" validate:"required,oneof=EUR BGN USD"`
	Items    []OrderItemRequest `json:"items" validate:"required,min=1,max=50,dive"`
}

type OrderItemRequest struct {
	SKU      string `json:"sku" validate:"required,sku"`
	Quantity int    `json:"quantity" validate:"required,min=1,max=100"`
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req CreateOrderRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := httpx.Validate(req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	// ...
}
```

## 3. Списък с грешки по полета

`validator.ValidationErrors` е slice от `FieldError`. Превръщаме го в наш тип, който `WriteError` разпознава с `errors.As` и рендерира като 422 Problem JSON (виж [Грешки](Errors.md)).

```go internal/httpx/validate.go
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationError struct {
	Fields []FieldError
}

func (e *ValidationError) Error() string { return "validation failed" }

// Namespace е "CreateOrderRequest.items[0].sku", махаме името на struct-а.
func fieldPath(fe validator.FieldError) string {
	_, path, _ := strings.Cut(fe.Namespace(), ".")
	return path
}

func message(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "is required"
	case "email":
		return "must be a valid email"
	case "min":
		return "must be at least " + fe.Param()
	case "max":
		return "must be at most " + fe.Param()
	case "oneof":
		return "must be one of: " + fe.Param()
	case "sku":
		return "must look like ABC-12345"
	default:
		return "is invalid"
	}
}
```

Отговорът към клиента изглежда така:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "errors": [
    { "field": "email", "message": "must be a valid email" },
    { "field": "items[0].sku", "message": "must look like ABC-12345" }
  ]
}
```

## 4. Собствено правило

Custom правило е функция, която получава `validator.FieldLevel` и връща `bool`. Регистрира се веднъж при създаването на инстанцията (горе в `newValidator`).

```go internal/httpx/validate.go
var skuRe = regexp.MustCompile(`^[A-Z]{3}-\d{5}$`)

func validSKU(fl validator.FieldLevel) bool {
	return skuRe.MatchString(fl.Field().String())
}
```

Правила, които искат база данни (уникален имейл, наличност на продукт), не са tags. Те са в service-а и връщат domain грешка като `order.ErrOutOfStock`.

## 5. Капани

- Без `RegisterTagNameFunc` клиентът получава `Email` и `Items[0].SKU`, имена, които не съществуват в неговия JSON.
- `required` на `int` отхвърля и `0`, защото това е zero value. Ако нулата е валидна стойност, ползвай `*int` или махни `required`.
- Без `dive` правилата на `OrderItemRequest` не се изпълняват, проверява се само самият slice.
- `validate.Struct` на nil указател или на не-struct връща `*validator.InvalidValidationError`. Това е bug в кода, не грешка на клиента, и правилно стига до 500.
- Не валидирай в store-а или в service-а със същите tags. Формата се проверява на границата (handler), бизнес правилата в service-а.

## 6. Свързани документи

- [Грешки](Errors.md)
- [JSON и DTO](JSON_DTO.md)
- [Handlers](Handlers.md)
- [Testing](Testing.md)
