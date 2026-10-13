PORT ?= 8084

.PHONY: run build

node_modules: package.json
	npm install
	@touch node_modules

build: node_modules
	npm run build

# Сервира dist/ и пребилдва при промяна в документите или widget-ите; след промяна презареди страницата.
run: build
	@echo "http://localhost:$(PORT)"
	@exec node --watch-path=md --watch-path=widgets --watch-path=manifest.json --watch-path=template.html --watch-path=build.mjs build.mjs > /dev/null & \
	WATCH=$$!; trap "kill $$WATCH 2>/dev/null" EXIT INT TERM; \
	cd dist && python3 -m http.server $(PORT)
