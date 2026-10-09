# gRPC

gRPC е бинарен RPC протокол върху HTTP/2 с договор в `.proto` файл и генериран типизиран код за сървър и клиент. Ползваме го за синхронна комуникация service-to-service между микросървиси, а за публичното API оставаме на JSON през HTTP.

## 1. Инсталация

Runtime библиотеките и `buf` за генериране на код; `buf` вика remote plugins, така че не ти трябва локален `protoc`.

```bash
go get google.golang.org/grpc@latest
go get google.golang.org/protobuf@latest
go install github.com/bufbuild/buf/cmd/buf@latest
```

## 2. Договор и генериране

```proto proto/order/v1/order.proto
syntax = "proto3";

package order.v1;

option go_package = "github.com/acme/shop/gen/order/v1;orderv1";

service OrderService {
  rpc GetOrder(GetOrderRequest) returns (GetOrderResponse);
}

message GetOrderRequest {
  int64 id = 1;
}

message GetOrderResponse {
  Order order = 1;
}

message Order {
  int64 id = 1;
  string status = 2;
  int64 total_cents = 3;
}
```

```yaml buf.yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

```yaml buf.gen.yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen
    opt: paths=source_relative
  - remote: buf.build/grpc/go
    out: gen
    opt: paths=source_relative
```

```bash
buf lint
buf generate
```

Получаваш `gen/order/v1/order.pb.go` и `order_grpc.pb.go`. Комитни ги в git и не ги редактирай на ръка.

## 3. Сървър

Вграждаш `UnimplementedOrderServiceServer`, за да се компилира и когато в proto-то се добави нов метод.

```go internal/order/grpc.go
package order

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	orderv1 "github.com/acme/shop/gen/order/v1"
)

type GRPCServer struct {
	orderv1.UnimplementedOrderServiceServer
	svc *Service
}

func NewGRPCServer(svc *Service) *GRPCServer { return &GRPCServer{svc: svc} }

func (s *GRPCServer) GetOrder(ctx context.Context, req *orderv1.GetOrderRequest) (*orderv1.GetOrderResponse, error) {
	o, err := s.svc.Get(ctx, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "order not found")
	}
	if err != nil {
		return nil, status.Error(codes.Internal, "internal error")
	}
	return &orderv1.GetOrderResponse{Order: &orderv1.Order{
		Id: o.ID, Status: string(o.Status), TotalCents: o.TotalCents,
	}}, nil
}
```

gRPC сървърът слуша на отделен порт до HTTP сървъра; interceptor-ите са gRPC аналогът на middleware.

```go cmd/api/main.go
lis, err := net.Listen("tcp", ":50051")
if err != nil {
	return err
}
gs := grpc.NewServer(grpc.ChainUnaryInterceptor(recoverInterceptor, logInterceptor))
orderv1.RegisterOrderServiceServer(gs, order.NewGRPCServer(orderSvc))

go func() {
	if err := gs.Serve(lis); err != nil {
		slog.Error("grpc serve", "err", err)
	}
}()
// при shutdown: gs.GracefulStop()
```

```go cmd/api/grpc.go
package main

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func logInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
	start := time.Now()
	resp, err := h(ctx, req)
	slog.InfoContext(ctx, "grpc", "method", info.FullMethod, "code", status.Code(err).String(), "duration", time.Since(start))
	return resp, err
}

func recoverInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, h grpc.UnaryHandler) (resp any, err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.ErrorContext(ctx, "grpc panic", "method", info.FullMethod, "panic", r)
			err = status.Error(codes.Internal, "internal error")
		}
	}()
	return h(ctx, req)
}
```

## 4. Клиент

`grpc.NewClient` не се свързва веднага, връзката се отваря при първото извикване. Създай го веднъж и го преизползвай. `insecure` е само за локална среда; в production ползвай TLS или mTLS, обикновено от service mesh.

```go internal/platform/grpcclient/order.go
package grpcclient

import (
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	orderv1 "github.com/acme/shop/gen/order/v1"
)

func NewOrderClient(addr string) (orderv1.OrderServiceClient, *grpc.ClientConn, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, err
	}
	return orderv1.NewOrderServiceClient(conn), conn, nil
}
```

Всяко извикване е с deadline, а грешката се разпознава по код:

```go internal/shipping/service.go
var ErrOrderNotFound = fmt.Errorf("order %w", apperr.ErrNotFound)

ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()

resp, err := s.orders.GetOrder(ctx, &orderv1.GetOrderRequest{Id: orderID})
if status.Code(err) == codes.NotFound {
	return ErrOrderNotFound
}
if err != nil {
	return fmt.Errorf("get order %d: %w", orderID, err)
}
```

## 5. Капани

- Без deadline извикване към увиснал сървис чака безкрайно. Винаги `context.WithTimeout` или подаден context с deadline.
- Обикновена Go грешка от handler се превръща в `codes.Unknown`. Връщай `status.Error` с конкретен код и не изтичай вътрешни детайли в съобщението.
- Не сменяй номера или типа на съществуващо поле в proto. `buf breaking --against '.git#branch=main'` в CI хваща това.
- `gs.Stop()` прекъсва текущите извиквания; при shutdown ползвай `gs.GracefulStop()`.
- Нов `grpc.NewClient` за всяка заявка отваря нова HTTP/2 връзка. Една връзка мултиплексира хиляди извиквания.

## 6. Свързани документи

- [Структура на микросървиси](Microservices_Structure.md)
- [HTTP клиенти](HTTP_Clients.md)
- [Context](Context.md)
- [Graceful shutdown](Graceful_Shutdown.md)
- [Метрики и tracing](Observability.md)
