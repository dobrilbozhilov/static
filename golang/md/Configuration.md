# Конфигурация

Конфигурацията на сървиса идва от environment променливи, които се четат веднъж при старт в един типизиран `Config` struct. Ползваме `caarlos0/env`, защото е без зависимости, чете struct tags и връща всички липсващи променливи наведнъж.

## 1. Инсталация

`godotenv` ни трябва само за локалния `.env` файл.

```bash
go get github.com/caarlos0/env/v11@latest
go get github.com/joho/godotenv@latest
```

## 2. Минимален пример

Всяко поле има `env` tag с името на променливата. `required` спира старта, ако я няма, `envDefault` дава стойност по подразбиране. `time.Duration` се парсва от низове като `5s` или `1m30s`.

```go internal/config/config.go
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"time"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Env      string `env:"APP_ENV" envDefault:"local"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	HTTP     HTTP   `envPrefix:"HTTP_"`
	DB       DB     `envPrefix:"DB_"`
	Redis    Redis  `envPrefix:"REDIS_"`
	OIDC     OIDC   `envPrefix:"OIDC_"`
	Mail     Mail   `envPrefix:"MAIL_"`
	Kafka    Kafka  `envPrefix:"KAFKA_"`
	NATS     NATS   `envPrefix:"NATS_"`
	S3       S3     `envPrefix:"S3_"`
}

type HTTP struct {
	Addr            string        `env:"ADDR" envDefault:":8080"`
	InternalAddr    string        `env:"INTERNAL_ADDR" envDefault:":9090"` // /metrics и /debug/pprof
	DrainDelay      time.Duration `env:"DRAIN_DELAY" envDefault:"5s"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"20s"`
	CORSOrigins     []string      `env:"CORS_ORIGINS" envSeparator:","`
}

type DB struct {
	URL      string `env:"URL,required"`
	MaxConns int32  `env:"MAX_CONNS" envDefault:"10"`
}

type Redis struct{ URL string `env:"URL" envDefault:"redis://localhost:6379/0"` }
type OIDC struct {
	IssuerURL string `env:"ISSUER_URL"`
	ClientID  string `env:"CLIENT_ID"`
}
type Mail struct {
	Host     string `env:"HOST" envDefault:"localhost"`
	Port     int    `env:"PORT" envDefault:"1025"`
	Username string `env:"USERNAME"`
	Password string `env:"PASSWORD"`
	From     string `env:"FROM" envDefault:"shop@example.com"`
}
type Kafka struct{ Brokers []string `env:"BROKERS" envSeparator:","` }
type NATS struct{ URL string `env:"URL" envDefault:"nats://localhost:4222"` }
type S3 struct {
	Endpoint string `env:"ENDPOINT"`
	Bucket   string `env:"BUCKET"`
	Region   string `env:"REGION" envDefault:"eu-central-1"`
}

func Load() (Config, error) {
	// В deploy APP_ENV се задава от платформата и .env файл няма.
	if env := os.Getenv("APP_ENV"); env == "" || env == "local" {
		if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return Config{}, fmt.Errorf("load .env: %w", err)
		}
	}

	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	return cfg, nil
}
```

`envPrefix:"DB_"` прави така, че полето `URL` в `DB` се чете от `DB_URL`, а `KAFKA_BROKERS=a:9092,b:9092` става `[]string`. Вложените structs държат конфигурацията подредена по компонент.

```ini .env
APP_ENV=local
LOG_LEVEL=debug
HTTP_ADDR=:8080
DB_URL=postgres://shop:shop@localhost:5432/shop?sslmode=disable
HTTP_SHUTDOWN_TIMEOUT=5s
```

`.env` е само за локална разработка и стои в `.gitignore`. `godotenv.Load()` не презаписва променливи, които вече са в средата, така че `DB_URL=... make run` печели пред файла.

## 3. Fail fast

Ако липсва задължителна променлива, сървисът трябва да падне веднага при старт, а не при първата заявка към базата.

```go cmd/api/main.go
cfg, err := config.Load()
if err != nil {
	slog.Error("invalid config", "err", err)
	os.Exit(1)
}
```

```text
invalid config err="parse config: env: required environment variable \"DB_URL\" is not set"
```

`env.ParseAs` събира всички грешки, така че виждаш всички липсващи променливи с едно пускане. В Kubernetes pod-ът влиза в `CrashLoopBackOff` и deploy-ът спира, вместо да мине с половин конфигурация.

## 4. Config се подава, не се чете глобално

`Config` се зарежда веднъж в `main.go` и всеки компонент получава в конструктора си само това, което му трябва. Няма `config.Get()` и няма `os.Getenv` извън пакета `config`.

```go cmd/api/main.go
log := logging.New(cfg.Env, cfg.LogLevel)

pool, err := db.New(ctx, cfg.DB.URL)
if err != nil {
	return err
}
defer pool.Close()

orderHandler := order.NewHandler(order.NewService(order.NewStore(pool), pool, log))
srv := server.New(cfg.HTTP.Addr, server.Routes(orderHandler))
return srv.Run(ctx, cfg.HTTP.DrainDelay, cfg.HTTP.ShutdownTimeout)
```

Пакетите `db`, `server` и `order` не import-ват `config`. В тестовете подаваш `":0"` или URL от testcontainers директно, без да пипаш environment-а на процеса.

## 5. Капани

- `os.Getenv` разпръснат из кода прави невъзможно да видиш на едно място от какво зависи сървисът.
- `envDefault` за пароли и URL-и на бази е опасен: production тръгва с локалната база. Ползвай `required`.
- `time.Duration` иска единица: `READ_TIMEOUT=5` е грешка при парсване, правилно е `5s`.
- Не логвай целия `Config` при старт, в него има пароли и tokens. Логвай само безопасни полета като `Env` и `HTTP.Addr`.
- Тайни в production идват от secret store (Kubernetes Secret, Vault) като environment променливи, не от `.env` в image-а.

## 6. Свързани документи

- [Структура на проекта](Project_Structure.md)
- [PostgreSQL с pgx](Postgres_pgx.md)
- [Logging със slog](Logging.md)
- [Docker и деплой](Docker_Deploy.md)
