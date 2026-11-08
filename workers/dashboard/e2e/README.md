# Agentic UI tests (e2e)

Two checks over the live dashboard: one deterministic (the home rails are
present and carry cards) and one agent-driven (the agent opens Guides and
Statistics and reports what it sees).

```bash
mkdir -p /tmp/e2e-dash && cp -r e2e/* /tmp/e2e-dash/ && cd /tmp/e2e-dash
npm init -y && npm i -D e2e ai @ai-sdk/openai-compatible @e2e-dev/web
set -a; . ~/.config/e2e.env; set +a      # E2E_LLM_BASE_URL / _MODEL / _API_KEY
export E2E_SESSION=$(cat ~/.cache/e2e-session)   # a live msp_dash_session value
./node_modules/.bin/e2e run
```

Model: any OpenAI-compatible endpoint (this repo points at the homelab LiteLLM
gateway). `@e2e-dev/web` is installed by `e2e init` in a real project; copy it
in when rebuilding from scratch.

**Cloudflare:** the dashboard sits behind a managed challenge. The config sends
a Firefox user-agent, which lets the document through; headless XHR still gets
401/403, so the agent test asserts the *degrade* path (the session notice), not
the data. Run it from a real browser profile if you need API-level assertions.
