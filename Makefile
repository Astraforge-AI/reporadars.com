.PHONY: verify
verify:
	npm run build
	npm run test:sites
	node --test tests/homepage-worker.test.mjs
	node --test tests/workspace-store.test.mjs
	node --test tests/catalog-worker.test.mjs
	node --test tests/locale-worker.test.mjs
	npx playwright test
