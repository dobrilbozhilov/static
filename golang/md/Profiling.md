# Profiling с pprof

pprof показва къде сървисът харчи CPU, памет и goroutines, вместо да гадаеш по метриките. Ползваш стандартния `net/http/pprof` за живия процес и `go test -cpuprofile` за benchmark-и, а и двата резултата се разглеждат с `go tool pprof`.

## 1. Минимален пример

pprof endpoint-ите се mount-ват на отделен вътрешен порт, никога на публичния router. Регистрираме handler-ите изрично върху собствен `ServeMux`, вместо blank import, който ги закача на `http.DefaultServeMux`.

```go internal/server/internal.go
package server

import (
	"net/http"
	"net/http/pprof"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// NewInternal обслужва /metrics и /debug/pprof/ на cfg.HTTP.InternalAddr.
func NewInternal(addr string) *http.Server {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)

	return &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		// Без WriteTimeout: CPU профилът по дизайн отговаря след 30 секунди.
	}
}
```

`pprof.Index` обслужва и именуваните профили: `/debug/pprof/heap`, `/debug/pprof/goroutine`, `/debug/pprof/allocs`, `/debug/pprof/mutex`, `/debug/pprof/block`.

```go cmd/api/main.go
	internalSrv := server.NewInternal(cfg.HTTP.InternalAddr) // ":9090"
	go func() {
		if err := internalSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("internal server", "err", err)
		}
	}()
	defer internalSrv.Close()
```

В Kubernetes портът не е в Service-а. Достъпваш го с port-forward само когато ти трябва.

```bash
kubectl port-forward deploy/shop-api 9090:9090
```

## 2. CPU профил

CPU профилът записва за N секунди къде е стекът на всеки 10 ms. Пусни го, докато има реален или синтетичен трафик, иначе ще видиш само idle.

```bash
go tool pprof -http=:8081 "http://localhost:9090/debug/pprof/profile?seconds=30"
```

`-http` отваря браузър с flame graph, граф и source изглед. Без него влизаш в интерактивен режим:

```text
$ go tool pprof "http://localhost:9090/debug/pprof/profile?seconds=30"
(pprof) top 15
(pprof) top -cum
(pprof) list order.\(\*Service\).Place
```

`top` сортира по собствено време на функцията, `top -cum` по време заедно с извиканите от нея. `list` показва кода ред по ред.

## 3. Heap и goroutines

Heap профилът показва какво е живо в паметта сега (`inuse_space`) или колко е алокирано от старта (`alloc_space`). За memory leak гледаш inuse, за натоварване на GC гледаш alloc.

```bash
go tool pprof -http=:8081 http://localhost:9090/debug/pprof/heap
go tool pprof -sample_index=alloc_space -http=:8081 http://localhost:9090/debug/pprof/heap

# два snapshot-а с минути разлика, после разликата между тях
curl -o heap1.pb.gz http://localhost:9090/debug/pprof/heap
curl -o heap2.pb.gz http://localhost:9090/debug/pprof/heap
go tool pprof -http=:8081 -diff_base heap1.pb.gz heap2.pb.gz
```

Растящ брой goroutines е най-честият leak. Текстовият изглед групира еднаквите стекове с брояч:

```bash
curl "http://localhost:9090/debug/pprof/goroutine?debug=1" | head -50
```

## 4. Benchmark с профил

Когато знаеш коя функция е бавна, я изолираш в benchmark и профилираш само нея. `b.Loop()` е Go 1.24+, затова тук е класическият цикъл с `b.N`.

```go internal/order/pricing_test.go
package order

import "testing"

func BenchmarkTotal(b *testing.B) {
	o := Order{Items: make([]Item, 50)}
	for i := range o.Items {
		o.Items[i] = Item{SKU: "ABC-12345", Quantity: 2, UnitPrice: 1999}
	}
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_ = o.Total()
	}
}
```

```bash
go test -run '^$' -bench . -benchmem -cpuprofile cpu.out -memprofile mem.out ./internal/order/
go tool pprof -http=:8081 cpu.out
```

```text
BenchmarkTotal-10    2856421    418.2 ns/op    0 B/op    0 allocs/op
```

`-run '^$'` пропуска обикновените тестове, за да не замърсят профила.

## 5. Капани

- `import _ "net/http/pprof"` закача endpoint-ите на `http.DefaultServeMux`. Ако някъде сервираш DefaultServeMux публично, профилите и `cmdline` стават достъпни отвън.
- CPU профил от процес без натоварване е безполезен. Профилирай под load test или в production с port-forward.
- `WriteTimeout` по-малък от `seconds` прекъсва CPU профила с празен отговор.
- Mutex и block профилите са празни, докато не включиш `runtime.SetMutexProfileFraction` и `runtime.SetBlockProfileRate`.
- Не сравнявай benchmark-и от един пуск. Пусни с `-count 10` и сравни с `benchstat`.

## 6. Свързани документи

- [Goroutines и конкурентност](Concurrency.md)
- [Метрики и tracing](Observability.md)
- [Testing](Testing.md)
- [Graceful shutdown](Graceful_Shutdown.md)
