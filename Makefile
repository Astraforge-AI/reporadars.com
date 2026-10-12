.PHONY: verify verify-importer
verify: verify-importer
	python3 tests/release_support_test.py
	npm run build
	npm run test:sites
	node --test tests/homepage-worker.test.mjs
	node --test tests/workspace-store.test.mjs
	node --test tests/catalog-worker.test.mjs
	node --test tests/locale-worker.test.mjs
	node --test tests/imported-*.test.mjs
	node --test tests/auth/*.test.mjs tests/intake-worker.test.mjs
	npm run build:runtime
	npm run test:runtime
	npx playwright test

verify-importer:
	cd importer && go test -race ./...
	cd importer && go vet ./...
