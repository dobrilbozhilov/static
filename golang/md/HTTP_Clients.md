# HTTP клиенти

Почти всеки сървис вика външни API: плащания, доставки, друг вътрешен сървис. Ползваме само `net/http` от стандартната библиотека с явни timeouts, обвит в малък типизиран клиент за всяко външно API.

## 1. Минимален пример

Никога `http.DefaultClient` или `http.Get` в production: нямат timeout и бавен партньор държи goroutine-и и връзки безкрайно. Създай един клиент при старт и го преизползвай, той пази pool от keep-alive връзки.

```go internal/platform/httpclient/httpclient.go
package httpclient

import (
	"net"
	"net/http"
	"time"
)

func New() *http.Client {
	return &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 8 * time.Second,
			MaxIdleConns:          100,
			// По подразбиране е 2: при натоварване към един host връзките постоянно се затварят и отварят.
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
		},
	}
}
```

## 2. Типизиран клиент

Всяко външно API получава собствен пакет: service слоят вика `payments.Charge`, а не сглобява URL-и и headers.

```go internal/platform/payments/client.go
package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string, hc *http.Client) *Client {
	return &Client{baseURL: baseURL, apiKey: apiKey, http: hc}
}

type ChargeRequest struct {
	OrderID     int64  `json:"order_id"`
	AmountCents int64  `json:"amount_cents"`
	Currency    string `json:"currency"`
}

type ChargeResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("payments: status %d: %s", e.StatusCode, e.Body)
}

func (c *Client) Charge(ctx context.Context, in ChargeRequest) (ChargeResponse, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return ChargeResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/charges", bytes.NewReader(body))
	if err != nil {
		return ChargeResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("order-%d", in.OrderID))

	resp, err := c.http.Do(req)
	if err != nil {
		return ChargeResponse{}, fmt.Errorf("payments: %w", err)
	}
	defer func() {
		// Изчитаме остатъка, иначе връзката не се връща в pool-а.
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return ChargeResponse{}, &APIError{StatusCode: resp.StatusCode, Body: string(msg)}
	}

	var out ChargeResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return ChargeResponse{}, fmt.Errorf("payments: decode: %w", err)
	}
	return out, nil
}
```

В service слоя проверяваш конкретния статус с `errors.As`:

```go internal/order/service.go
var ErrPaymentDeclined = fmt.Errorf("payment declined: %w", apperr.ErrInvalid) // 422 през httpx.WriteError

var apiErr *payments.APIError
if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusPaymentRequired {
	return ErrPaymentDeclined
}
```

## 3. Retry с backoff

Повтаряй само идемпотентни заявки: `GET`, `PUT`, `DELETE` или `POST` с `Idempotency-Key`, който партньорът поддържа. Повтаряй мрежови грешки, 429 и 5xx; 4xx означава, че заявката е грешна и повторението няма да помогне.

```go internal/platform/httpclient/retry.go
package httpclient

import (
	"context"
	"math/rand/v2"
	"time"
)

func Retry(ctx context.Context, attempts int, fn func() error, retryable func(error) bool) error {
	var err error
	for i := range attempts {
		if err = fn(); err == nil || !retryable(err) {
			return err
		}
		if i == attempts-1 {
			break
		}
		// 200ms, 400ms, 800ms... плюс jitter, за да не удрят всички реплики едновременно.
		backoff := 200 * time.Millisecond << i
		sleep := backoff/2 + rand.N(backoff/2)
		select {
		case <-time.After(sleep):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return err
}
```

Използване: `httpclient.Retry(ctx, 3, func() error { out, err = c.Charge(ctx, in); return err }, isRetryable)`, където `isRetryable` връща `true` за `net.Error` и за `*APIError` със статус 429 или 5xx.

## 4. Капани

- Без `defer resp.Body.Close()` изтичат връзки и файлови дескриптори, докато сървисът не спре да отваря нови.
- `Client.Timeout` покрива цялата заявка, включително четенето на body. За големи downloads ползвай context с deadline вместо глобален timeout.
- Нов `http.Client` и `http.Transport` за всяка заявка убива keep-alive и прави TLS handshake всеки път. Създай ги веднъж в `main`.
- Retry на неидемпотентен `POST` без `Idempotency-Key` може да таксува клиента два пъти.
- Не логвай `req.Header`: вътре е API ключът.

## 5. Свързани документи

- [Context](Context.md)
- [Грешки](Errors.md)
- [Конфигурация](Configuration.md)
- [Метрики и tracing](Observability.md)
- [gRPC](GRPC.md)
