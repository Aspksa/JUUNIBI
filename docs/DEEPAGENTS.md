# Deep Agents — optional experimental integration

This is an **opt-in, standalone** Python sidecar for research/planning tasks in JUUNIBI.
It does **not** replace the existing TypeScript assistant or register as a JUUNIBI
runtime module. It is not installed automatically by npm or JUUNIBI.bat.

Upstream: https://github.com/langchain-ai/deepagents (MIT).

## Windows setup

From the JUUNIBI repository root, with Python 3.11+ installed:

```powershell
py -m venv .venv-deepagents
.\.venv-deepagents\Scripts\python.exe -m pip install -r scripts/deepagents_requirements.txt
Copy-Item .env.example .env
```

Do **not** overwrite an existing `.env`. Set the variables using the local
configuration mechanism:

```dotenv
CLOUDRU_API_KEY=your-server-side-key
CLOUDRU_MODEL=DeepSeek-V4-Flash
CLOUDRU_BASE_URL=https://foundation-models.api.cloud.ru/v1
```

Use the **exact model identifier shown by Cloud.ru**. The example value above
is not proof that it is the API's precise model ID.

Test without exposing credentials:

```powershell
.\.venv-deepagents\Scripts\python.exe scripts/deepagents_bridge.py "Plan a read-only audit of JUUNIBI"
```

## Scope and security

- The adapter uses a ChatOpenAI-compatible Cloud.ru endpoint. It requires
  provider support for agent tool calling; verify with a live smoke test.
- No host shell or browser control is exposed by this adapter.
- Deep Agents' default workspace is virtual. Do not mistake generated virtual
  files for real JUUNIBI repository edits.
- Do not paste API tokens into chat, commit `.env`, or send credentials to the browser.
- External dependencies are installed separately; audit versions and licenses.
- Running this Python script currently requires an explicit terminal command.
  No app button, HTTP endpoint, background service, persistence, or Windows
  auto-installation is claimed.
- To integrate into JUUNIBI's UI later, build an authenticated server-side API
  with timeouts, rate limits, allowlisted tools, approval gates and audit logs,
  then add CI integration tests with a mocked Cloud.ru API.

## JUUNIBI local API (experimental)

After installing Python dependencies, enable `JUUNIBI_DEEPAGENTS_ENABLED=1`
in the server-side `.env` and restart JUUNIBI. The Node server provides:

- `GET /api/deepagents/status` — enabled flag and an explicit unverified install status.
- `POST /api/deepagents/run` with JSON `{"prompt":"Plan a safe test"}` — runs the Python adapter.

The endpoints are restricted to the local desktop listener and blocked on the
paired LAN listener. Requests have a 4,000-character input cap, bounded output,
and a two-minute subprocess timeout. The setting is **off by default**.
This is a server API, not yet a chat UI toggle or replacement for the current brain.
The first live tool-calling smoke test must be run locally with a real Cloud.ru key.
