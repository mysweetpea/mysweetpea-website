# Agentic UI tests (e2e) — public site

No auth needed; runs against the live site (Cloudflare permits the Firefox UA).

```bash
mkdir -p /tmp/e2e-site && cp -r e2e/* /tmp/e2e-site/ && cd /tmp/e2e-site
npm init -y && npm i -D e2e ai @ai-sdk/openai-compatible @e2e-dev/web
fish -lc 'set -x E2E_LLM_BASE_URL $E2E_LLM_BASE_URL; set -x E2E_LLM_API_KEY $E2E_LLM_API_KEY; set -x E2E_LLM_MODEL $E2E_LLM_MODEL'
./node_modules/.bin/e2e run
```

The status test is a regression guard for the Nov 2026 "0 of 0 operational"
class: it fails if the data layer collapses again or rows stay on "Checking…".
