# Sessions и cookies

Session с cookie ти трябва само за server-rendered сайт, където браузърът зарежда HTML директно от Go; JSON API-то ползва Bearer token-и (виж [Authentication](Authentication.md)). Cookie-то носи само случаен session id, а данните стоят в Redis, така че всички инстанции виждат една и съща session.

## 1. Инсталация

Ползваме `scs`, защото е малък, работи с всеки `http.Handler` и има готов Redis store върху `go-redis` v9.

```bash
go get github.com/alexedwards/scs/v2@latest
go get github.com/alexedwards/scs/goredisstore@latest
```

## 2. Минимален пример

Session manager-ът се създава веднъж, с Redis client-а от [Redis и кеш](Redis_Cache.md).

```go internal/server/session.go
package server

import (
	"net/http"
	"time"

	"github.com/alexedwards/scs/goredisstore"
	"github.com/alexedwards/scs/v2"
	"github.com/redis/go-redis/v9"
)

func NewSessionManager(rdb *redis.Client, secure bool) *scs.SessionManager {
	sm := scs.New()
	sm.Store = goredisstore.New(rdb)
	sm.Lifetime = 24 * time.Hour
	sm.IdleTimeout = 30 * time.Minute
	sm.Cookie.Name = "shop_session"
	sm.Cookie.HttpOnly = true
	sm.Cookie.Secure = secure // false само локално по http
	sm.Cookie.SameSite = http.SameSiteLaxMode
	sm.Cookie.Path = "/"
	return sm
}
```

`LoadAndSave` зарежда session-а преди handler-а и записва промените след него. CSRF защитата обвива целия router.

```go internal/server/routes.go
func (s *Server) routes() http.Handler {
	r := chi.NewRouter()
	r.Use(s.sessions.LoadAndSave)

	r.Get("/", s.web.Home)
	r.Post("/login", s.web.Login)
	r.Post("/logout", s.web.Logout)

	return http.NewCrossOriginProtection().Handler(r)
}
```

## 3. Login, четене и logout

При login винаги сменяй session id-то с `RenewToken`, за да няма session fixation. При logout `Destroy` трие записа в Redis и изчиства cookie-то.

```go internal/user/handler.go
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	userID, err := h.svc.Login(r.Context(), r.FormValue("email"), r.FormValue("password"))
	if err != nil {
		h.render(w, "login.html", map[string]any{"Error": "грешен имейл или парола"})
		return
	}
	if err := h.sessions.RenewToken(r.Context()); err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	h.sessions.Put(r.Context(), "userID", userID)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (h *Handler) Home(w http.ResponseWriter, r *http.Request) {
	userID := h.sessions.GetInt64(r.Context(), "userID") // users.id, int64 както навсякъде
	if userID == 0 {
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	h.render(w, "home.html", map[string]any{"UserID": userID})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.sessions.Destroy(r.Context()); err != nil {
		http.Error(w, "session error", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
```

Пази в session-а само малки стойности (id, flash съобщение). Профила и количката чети от базата.

## 4. CSRF с net/http

От Go 1.25 `http.NewCrossOriginProtection()` блокира cross-origin заявки с небезопасни методи (POST, PUT, PATCH, DELETE). Проверява header-а `Sec-Fetch-Site`, който всички съвременни браузъри пращат, а ако го няма, сравнява `Origin` с `Host`. GET, HEAD и OPTIONS минават винаги, отхвърлените заявки получават 403. Не трябват скрити token-и във формите.

Ако друг твой домейн легитимно праща POST към сайта, създай protection-а в `main.go` и разреши го изрично:

```go internal/server/session.go
func NewCSRF(trusted []string) (*http.CrossOriginProtection, error) {
	cop := http.NewCrossOriginProtection()
	for _, origin := range trusted {
		// очаква точен origin, например https://admin.acme.com, без path
		if err := cop.AddTrustedOrigin(origin); err != nil {
			return nil, err
		}
	}
	return cop, nil
}
```

В `routes()` тогава връщаш `s.csrf.Handler(r)` вместо `http.NewCrossOriginProtection().Handler(r)`.

## 5. Капани

- Без `RenewToken` при login нападател може да ти подхвърли известно session id и да го ползва след като влезеш.
- `Secure: true` в production е задължително; локално по `http://localhost` го изключи през конфигурацията, иначе браузърът не праща cookie-то.
- GET handler-и не трябва да променят състояние: CSRF защитата пропуска GET, така че `GET /logout` е отворена врата.
- `SameSite=Lax` позволява cookie-то при навигация от външен линк, затова login-ът след редирект от OIDC provider работи. `Strict` би го счупил.
- Заявки без `Sec-Fetch-Site` и без `Origin` (curl, сървър към сървър) минават. Това е нарочно: CSRF е атака през браузъра.

## 6. Свързани документи

- [Redis и кеш](Redis_Cache.md)
- [Authentication](Authentication.md)
- [Middleware](Middleware.md)
- [Backend и фронтенд](Frontend_Backend.md)
