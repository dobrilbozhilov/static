# Authorization

Authorization решава какво може да прави вече идентифициран потребител: ролите идват от token-а (виж [Authentication](Authentication.md)), а проверката за собственост живее в service слоя. Два механизма покриват почти всичко: `RequireRole` middleware за цели групи routes и ownership check за конкретен запис.

## 1. Минимален пример

Не трябва нова библиотека: `auth.User` вече носи `Roles`, взети от `realm_access.roles`. `RequireRole` пуска заявката, ако потребителят има поне една от изброените роли, иначе връща 403.

```go internal/auth/middleware.go
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := UserFrom(r.Context())
			if !ok {
				// RequireRole без Authenticate преди него е грешка в routes.go
				httpx.WriteProblem(w, r, http.StatusUnauthorized, "липсва потребител")
				return
			}
			for _, role := range roles {
				if user.HasRole(role) {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.WriteProblem(w, r, http.StatusForbidden, "нямаш права за това действие")
		})
	}
}
```

## 2. Роли на група routes

Admin routes са отделна chi група вътре в защитената. Редът е важен: първо `Authenticate`, после `RequireRole`.

```go internal/server/routes.go
func (s *Server) routes(verifier *oidc.IDTokenVerifier, users auth.UserResolver) http.Handler {
	r := chi.NewRouter()
	r.Get("/products", s.products.List)

	r.Group(func(r chi.Router) {
		r.Use(auth.Authenticate(verifier, users))
		r.Mount("/orders", s.orders.Routes())

		r.Route("/admin", func(r chi.Router) {
			r.Use(auth.RequireRole("admin"))
			r.Post("/products", s.products.Create)
			r.Delete("/products/{id}", s.products.Delete)
			r.Get("/orders", s.orders.ListAll)
		})
	})
	return r
}
```

Ако само един endpoint иска роля, ползвай `r.With(auth.RequireRole("admin")).Delete(...)` вместо нова група.

## 3. Собственост в service-а

Ролята не стига за "потребителят вижда само своите поръчки": това зависи от данните, затова проверката е в service-а, след като записът е зареден.

```go internal/order/service.go
func (s *Service) Get(ctx context.Context, user auth.User, id int64) (Order, error) {
	o, err := s.store.GetOrder(ctx, id)
	if err != nil {
		return Order{}, err
	}
	if o.UserID != user.ID && !user.HasRole("admin") { // и двете са int64 (users.id)
		return Order{}, ErrForbidden
	}
	return o, nil
}
```

Handler-ът подава потребителя от context-а и оставя `httpx.WriteError` да превърне грешката в Problem JSON.

```go internal/order/handler.go
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	user, _ := auth.UserFrom(r.Context())
	id, err := strconv.ParseInt(chi.URLParam(r, "orderID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, r, fmt.Errorf("%w: невалидно id", httpx.ErrBadRequest))
		return
	}
	o, err := h.svc.Get(r.Context(), user, id)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toOrderResponse(o))
}
```

`ErrForbidden` следва модела от [Грешки](Errors.md): вид в `apperr`, който domain пакетът обвива, и един `case` в `httpx`.

```go internal/apperr/apperr.go
var ErrForbidden = errors.New("forbidden")
```

```go internal/order/model.go
var ErrForbidden = fmt.Errorf("order %w", apperr.ErrForbidden)
```

```go internal/httpx/problem.go
	case errors.Is(err, apperr.ErrForbidden):
		WriteProblem(w, r, http.StatusForbidden, "нямаш достъп до този ресурс")
```

За списъци не филтрирай в Go: подай `user.ID` в sqlc заявката (`WHERE user_id = $1`), иначе pagination-ът връща грешни страници.

## 4. Капани

- 401 значи "не знам кой си", 403 значи "знам, но не може". Не ги разменяй, клиентите реагират различно.
- Ownership проверката е в service-а, не в handler-а, за да важи и за gRPC, jobs и всеки друг вход.
- За чужд ресурс понякога е по-добре да върнеш 404 вместо 403, за да не издаваш, че id-то съществува. Избери едно правило за целия API.
- Ролите в token-а са актуални до изтичането му. Дръж access token-ите кратки (5 минути), иначе отнета роля работи още дълго.
- Не проверявай роли по `Email` или по hardcoded user id; само по `Roles` от token-а.

## 5. Свързани документи

- [Authentication](Authentication.md)
- [Middleware](Middleware.md)
- [Грешки](Errors.md)
- [Routing с chi](Routing.md)
- [Pagination](Pagination.md)
