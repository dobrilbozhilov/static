# Docker и деплой

Go се компилира до един статичен binary, затова image-ът в production съдържа само него върху distroless база и тежи около 20 MB. Тук са Dockerfile-ът, локалният `compose.yaml`, Kubernetes deployment-ът и CI pipeline-ът, които всеки сървис копира.

## 1. Минимален пример: Dockerfile

Multi-stage build: първият stage компилира, вторият съдържа само binary-то.

```dockerfile Dockerfile
FROM golang:1.25 AS build
WORKDIR /src

# зависимостите в отделен layer, за да не се теглят при всяка промяна на кода
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot
EXPOSE 8080 9090
ENTRYPOINT ["/api"]
```

```text .dockerignore
.git
.env
web/node_modules
bin/
tmp/
*.out
```

`CGO_ENABLED=0` дава статичен binary, който тръгва без libc. `-trimpath` маха локалните пътища, `-s -w` маха debug символите. Distroless няма shell, затова health проверки и debug стават отвън, не с `docker exec sh`.

## 2. compose.yaml за локална разработка

```yaml compose.yaml
services:
  api:
    build: .
    env_file: .env
    environment:
      DB_URL: postgres://shop:shop@postgres:5432/shop?sslmode=disable
      REDIS_URL: redis://redis:6379/0
      MAIL_HOST: mailpit
      MAIL_PORT: "1025"
    ports: ["8080:8080", "9090:9090"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: shop
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shop -d shop"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]

volumes:
  pgdata:
```

В ежедневната работа пускаш само зависимостите с `docker compose up -d postgres redis mailpit` и API-то с `air` на хоста. Целият stack с `docker compose up --build` е за проверка на image-а.

## 3. Ресурси в контейнер

От Go 1.25 runtime-ът сам чете CPU limit-а на cgroup-а и настройва `GOMAXPROCS`, така че не ти трябва нищо за CPU. Паметта не е автоматична: задай `GOMEMLIMIT` на около 90% от memory limit-а, за да почне GC да работи по-агресивно преди OOM kill.

## 4. Kubernetes

```yaml k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
spec:
  replicas: 3
  selector:
    matchLabels: { app: shop-api }
  template:
    metadata:
      labels: { app: shop-api }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: ghcr.io/acme/shop-api:1.4.2
          ports:
            - { name: http, containerPort: 8080 }
            - { name: internal, containerPort: 9090 }
          env:
            - name: GOMEMLIMIT
              value: "450MiB"
            - name: DB_URL
              valueFrom:
                secretKeyRef: { name: shop-api, key: database-url }
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { cpu: "1", memory: 512Mi }
          livenessProbe:
            httpGet: { path: /livez, port: internal }
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            periodSeconds: 5
            failureThreshold: 2
```

`terminationGracePeriodSeconds` трябва да е по-голям от timeout-а за `srv.Shutdown` в приложението (виж [Graceful shutdown](Graceful_Shutdown.md)). Endpoint-ите `/livez` и `/readyz` са описани в [Метрики и tracing](Observability.md).

## 5. CI с GitHub Actions

```yaml .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - run: go test ./... -race -cover
      - uses: golangci/golangci-lint-action@v8
        with: { version: latest }

  image:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/acme/shop-api:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

`ubuntu-latest` runner-ът има Docker, така че testcontainers тестовете от [Testing](Testing.md) вървят без допълнителна настройка.

## 6. Капани

- Тагът `latest` в deployment-а прави rollback невъзможен. Ползвай SHA или semver таг.
- Без `.dockerignore` `COPY . .` праща `.git` и `.env` в build context-а и тайните влизат в layer.
- Liveness probe, който проверява базата, рестартира всички pod-ове при проблем в Postgres. Базата е само в readiness.
- Миграциите не се пускат от всеки replica при старт. Пусни ги като отделен Job или init стъпка преди rollout-а (виж [Миграции](Migrations.md)).
- Ако приложението не хваща `SIGTERM`, Kubernetes го убива след grace периода и заявките в движение се губят.

## 7. Свързани документи

- [Graceful shutdown](Graceful_Shutdown.md)
- [Метрики и tracing](Observability.md)
- [Конфигурация](Configuration.md)
- [Testing](Testing.md)
- [Миграции](Migrations.md)
