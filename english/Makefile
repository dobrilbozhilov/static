.PHONY: run build

node_modules: package.json
	npm install
	@touch node_modules

run: node_modules
	npm run dev

build: node_modules
	npm run build
