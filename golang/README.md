# Go наръчник

Документите в `md/` са източникът на истината. Билдът ги събира в една HTML страница с меню, по една
страница на документ, Mermaid диаграми и highlight на кода.

```bash
cd golang
npm install
npm run build        # създава dist/index.html и dist/pages/*.html
```

Редът на страниците и групите са в `manifest.json`. Всеки документ е кратък: две изречения въведение,
инсталация, минимален работещ пример, едно-две важни неща, "Капани" и "Свързани документи". За всяка
тема е избрана една библиотека. Пътят на файла се пише в info реда на code fence-а:

    ```go internal/order/handler.go

Module path във всички примери е `github.com/acme/shop`, структурата е `cmd/` + `internal/` по feature.
