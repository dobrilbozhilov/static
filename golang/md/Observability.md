# Метрики и tracing

Метриките казват колко и колко бързо, а tracing-ът показва пътя на една заявка през сървисите. Ползваме Prometheus `client_golang` за метрики и OpenTelemetry с OTLP exporter за traces, плюс два health endpoint-а за Kubernetes.

## 1. Инсталация

Трябват ти Prometheus клиентът, OTel SDK-то, gRPC exporter-ът и `otelhttp`.

```bash
go get github.com/prometheus/client_golang/prometheus@latest
go get go.opentelemetry.io/otel@latest
go get go.opentelemetry.io/otel/sdk@latest
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc@latest
go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@latest
```

## 2. Минимален пример: HTTP метрики

```go internal/observability/metrics.go
package observability

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "HTTP requests by route and status.",
	}, []string{"method", "route", "status"})

	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route"})

	OrdersPlaced = promauto.NewCounter(prometheus.CounterOpts{
		Name: "shop_orders_placed_total",
		Help: "Successfully placed orders.",
	})
)

func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		// pattern-ът (/orders/{id}) се знае чак след routing, затова се чете след ServeHTTP
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		httpRequests.WithLabelValues(r.Method, route, strconv.Itoa(ww.Status())).Inc()
		httpDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
	})
}
```

`/metrics`, `/livez` и pprof са на отделен вътрешен порт (`cfg.HTTP.InternalAddr`, по подразбиране `:9090`), който не минава през ingress-а:

```go internal/server/internal.go
func NewInternal(addr string) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", promhttp.Handler())
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/debug/pprof/", pprof.Index) // net/http/pprof, виж Profiling
	return &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
}
```

```go cmd/api/main.go
internal := server.NewInternal(cfg.HTTP.InternalAddr)
go func() {
	if err := internal.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("internal server", slog.Any("err", err))
	}
}()
defer internal.Close()
```

`/livez` проверява само, че процесът отговаря. Ако там пинг-неш базата, падане на Postgres рестартира всички pod-ове без полза. `/readyz` живее на публичния `server.New`, защото отразява drain състоянието при спиране (виж [Graceful shutdown](Graceful_Shutdown.md)).

## 3. Tracing с OpenTelemetry

```go internal/observability/tracing.go
package observability

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Endpoint-ът идва от OTEL_EXPORTER_OTLP_ENDPOINT, който exporter-ът чете сам.
func InitTracing(ctx context.Context, service string) (func(context.Context) error, error) {
	exp, err := otlptracegrpc.New(ctx)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceName(service))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	return tp.Shutdown, nil
}
```

```go cmd/api/main.go
shutdownTracing, err := observability.InitTracing(ctx, "shop-api")
if err != nil {
	slog.Error("init tracing", slog.Any("err", err))
	os.Exit(1)
}
// Shutdown изпраща буферираните span-ове; без него последните секунди се губят
defer shutdownTracing(context.WithoutCancel(ctx))

handler := otelhttp.NewHandler(server.Routes(deps), "http")
srv := server.New(cfg.HTTP.Addr, handler)
```

`otelhttp.NewHandler` чете `traceparent` header-а и създава span за всяка заявка. За собствен span в service:

```go internal/order/service.go
var tracer = otel.Tracer("github.com/acme/shop/internal/order")

func (s *Service) Place(ctx context.Context, userID int64, in PlaceInput) (Order, error) {
	ctx, span := tracer.Start(ctx, "order.Place")
	defer span.End()
	// ...
}
```

Подавай същия `ctx` към pgx и HTTP клиентите, за да се вържат child span-овете. За изходящи заявки обвий transport-а с `otelhttp.NewTransport` (виж [HTTP клиенти](HTTP_Clients.md)).

## 4. Капани

- Label с `r.URL.Path` или user ID създава нова серия за всяко ID и убива Prometheus. Само route pattern, метод и статус.
- `chi.RouteContext(...).RoutePattern()` е празен преди routing-а. Чети го след `next.ServeHTTP`.
- Ако middleware-ът е в `r.Use` на вложен router, pattern-ът е само на подрутера. Сложи `Metrics` на главния router.
- `/metrics` на публичния порт изтича вътрешна информация. Дръж го на вътрешния порт.
- Без `tp.Shutdown` при graceful shutdown последните span-ове не стигат до collector-а (виж [Graceful shutdown](Graceful_Shutdown.md)).

## 5. Свързани документи

- [Logging със slog](Logging.md)
- [Middleware](Middleware.md)
- [Graceful shutdown](Graceful_Shutdown.md)
- [Docker и деплой](Docker_Deploy.md)
- [Profiling с pprof](Profiling.md)
