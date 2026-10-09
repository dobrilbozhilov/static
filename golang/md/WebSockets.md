# WebSockets

WebSocket е постоянна двупосочна връзка между браузъра и сървиса, нужна когато сървърът трябва сам да праща данни: статус на поръчка, известия, admin dashboard. Структурата е винаги една: hub, който държи връзките, и по две goroutine-и на клиент, една за четене и една за писане.

## 1. Инсталация

Ползваме `gorilla/websocket`, защото е де факто стандартът в Go екосистемата и има проверен модел с hub.

```bash
go get github.com/gorilla/websocket@latest
```

## 2. Минимален пример

Hub-ът е единственият собственик на map-а с клиенти, затова няма mutex: всичко минава през channel-и в един run loop.

```go internal/platform/ws/hub.go
package ws

import "context"

type Hub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
}

func NewHub() *Hub {
	return &Hub{
		clients:    map[*Client]bool{},
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
	}
}

func (h *Hub) Broadcast(msg []byte) { h.broadcast <- msg }

func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true
		case c := <-h.unregister:
			if h.clients[c] {
				delete(h.clients, c)
				close(c.send)
			}
		case msg := <-h.broadcast:
			for c := range h.clients {
				select {
				case c.send <- msg:
				default: // бавен клиент: изхвърляме го, вместо да блокираме всички
					delete(h.clients, c)
					close(c.send)
				}
			}
		case <-ctx.Done():
			return
		}
	}
}
```

Gorilla връзката не е безопасна за едновременно писане, затова само `writePump` пише в нея, а останалите подават съобщения през `send`.

```go internal/platform/ws/client.go
package ws

import (
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = pongWait * 9 / 10
)

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "https://shop.acme.com"
	},
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade вече е върнал HTTP грешка
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, 64)}
	h.register <- c
	go c.writePump()
	go c.readPump()
}

func (c *Client) readPump() {
	defer func() { c.hub.unregister <- c; c.conn.Close() }()
	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() { ticker.Stop(); c.conn.Close() }()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

Ping-ът на всеки 54 секунди и read deadline от 60 секунди откриват мъртви връзки, които TCP сам не забелязва.

## 3. Authentication на upgrade заявката

Браузърният `WebSocket` не може да праща `Authorization` header, затова token-ът идва в query параметър и малък middleware го премества в header-а преди `auth.Authenticate` (виж [Authentication](Authentication.md)).

```go internal/server/routes.go
r.Group(func(r chi.Router) {
	r.Use(tokenFromQuery, auth.Authenticate(verifier, userStore))
	r.Get("/ws", s.hub.ServeWS)
})

func tokenFromQuery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if t := r.URL.Query().Get("access_token"); t != "" {
			r.Header.Set("Authorization", "Bearer "+t)
		}
		next.ServeHTTP(w, r)
	})
}
```

В `cmd/api/main.go` пускаш `go hub.Run(ctx)` и подаваш `hub.Broadcast` например на async слушател за `OrderPlaced` от [Events в процеса](Events.md). В браузъра:

```html
<script>
  function connect() {
    const ws = new WebSocket(`wss://api.acme.com/ws?access_token=${getToken()}`);
    ws.onmessage = (e) => console.log("update", JSON.parse(e.data));
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
</script>
```

## 4. Капани

- `CheckOrigin: return true` позволява на всеки сайт да отвори връзка с cookie-тата на потребителя. Проверявай origin-а изрично.
- Две goroutine-и, които пишат в един `*websocket.Conn`, дават повредени frame-ове или паника. Пиши само от `writePump`.
- Token-ът в query попада в access логовете на proxy-тата. Не логвай query string за `/ws` и дръж access token-ите краткотрайни.
- Load balancer-ът затваря неактивни връзки (често след 60 секунди); ping-ът ги държи живи.
- Hub-ът е в паметта на една инстанция. При няколко реплики разпращай съобщенията през [NATS](NATS.md), а всяка инстанция ги подава на своя hub.

## 5. Свързани документи

- [Authentication](Authentication.md)
- [Events в процеса](Events.md)
- [NATS](NATS.md)
- [Goroutines и конкурентност](Concurrency.md)
- [Graceful shutdown](Graceful_Shutdown.md)
