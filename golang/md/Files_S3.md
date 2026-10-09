# Файлове и S3

Качените файлове не стоят на диска на сървиса, а в S3 съвместимо хранилище: AWS S3 в production и MinIO локално, с един и същ код. API-то приема multipart upload, записва обекта под генериран ключ, а за сваляне дава presigned URL с кратък срок.

## 1. Инсталация

Ползваме официалния AWS SDK v2, защото работи и с MinIO, и има presign client.

```bash
go get github.com/aws/aws-sdk-go-v2/config@latest
go get github.com/aws/aws-sdk-go-v2/service/s3@latest
```

```yaml compose.yaml
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: >
      sh -c "until mc alias set local http://minio:9000 minioadmin minioadmin; do sleep 1; done;
             mc mb --ignore-existing local/shop-uploads"
```

```ini .env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=shop-uploads
```

## 2. Минимален пример

`LoadDefaultConfig` чете region и credentials от env, а в AWS от IAM role. `BaseEndpoint` и `UsePathStyle` се задават само за MinIO.

```go internal/platform/storage/s3.go
package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Storage struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

func New(ctx context.Context, endpoint, bucket string) (*Storage, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true // MinIO не поддържа bucket като subdomain
		}
	})
	return &Storage{client: client, presign: s3.NewPresignClient(client), bucket: bucket}, nil
}

func (s *Storage) Put(ctx context.Context, key, contentType string, body io.Reader) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	})
	return err
}

func (s *Storage) DownloadURL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	req, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
```

В `cmd/api/main.go` го създаваш с `storage.New(ctx, cfg.S3.Endpoint, cfg.S3.Bucket)`, стойностите идват от `S3_*` променливите през `config.Load()`.

## 3. Upload handler

`MaxBytesReader` реже тялото на 5 MB, преди да е прочетено. Типът се определя от съдържанието, не от `Content-Type` на клиента, а ключът се генерира, за да не зависи от името на файла.

```go internal/product/handler.go
const maxImageSize = 5 << 20

var allowedImages = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImageSize)
	if err := r.ParseMultipartForm(maxImageSize); err != nil {
		httpx.WriteProblem(w, r, http.StatusRequestEntityTooLarge, "файлът е над 5 MB")
		return
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		httpx.WriteProblem(w, r, http.StatusBadRequest, "липсва поле image")
		return
	}
	defer file.Close()

	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	contentType := http.DetectContentType(head[:n])
	ext, ok := allowedImages[contentType]
	if !ok {
		httpx.WriteProblem(w, r, http.StatusUnsupportedMediaType, "позволени са jpeg, png и webp")
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	key := "products/" + chi.URLParam(r, "productID") + "/" + rand.Text() + ext
	if err := h.storage.Put(r.Context(), key, contentType, file); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"key": key})
}
```

`rand.Text()` е от `crypto/rand` (Go 1.24+) и дава 26 случайни символа. В базата пазиш само `key`, никога URL.

## 4. Presigned URL за сваляне

Bucket-ът остава private. При всяко четене генерираш URL с кратък срок, браузърът тегли директно от S3, без да минава през API-то.

```go internal/product/handler.go
url, err := h.storage.DownloadURL(r.Context(), p.ImageKey, 15*time.Minute)
```

## 5. Капани

- Без `MaxBytesReader` клиентът може да прати гигабайти; `ParseMultipartForm` лимитира само паметта, излишъкът отива във временни файлове.
- Presigned URL съдържа host-а от `BaseEndpoint`. Ако API-то в compose ползва `http://minio:9000`, браузърът не може да отвори линка.
- Не използвай оригиналното име на файла като ключ: path traversal, колизии и лични данни в URL-а.
- Не прави bucket-а публичен "за удобство"; presigned URL е също толкова прост и изтича.
- Изтрий обекта, когато триеш записа в базата, иначе bucket-ът расте с сираци. Най-лесно е с background job.

## 6. Свързани документи

- [Handlers](Handlers.md)
- [Конфигурация](Configuration.md)
- [Background jobs](Background_Jobs.md)
- [Docker и деплой](Docker_Deploy.md)
