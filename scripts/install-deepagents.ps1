# Explicit opt-in installer. Run from a trusted PowerShell terminal.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $root ".venv-deepagents\Scripts\python.exe"
if (-not (Test-Path $python)) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) { & py -3.11 -m venv (Join-Path $root ".venv-deepagents") }
  else {
    $exe = Get-Command python -ErrorAction Stop
    & $exe.Source -m venv (Join-Path $root ".venv-deepagents")
  }
  if ($LASTEXITCODE -ne 0) { throw "Python virtual environment setup failed" }
}
& $python -m pip install -r (Join-Path $root "scripts/deepagents_requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Deep Agents dependencies installation failed" }
& $python -c "from deepagents import create_deep_agent; from langchain_openai import ChatOpenAI; print('Deep Agents imports OK')"
if ($LASTEXITCODE -ne 0) { throw "Deep Agents import check failed" }
Write-Host "Dependencies ready. Set JUUNIBI_DEEPAGENTS_ENABLED=1 in the existing .env and restart JUUNIBI."
Write-Host "A live Cloud.ru smoke test is still needed. Never commit .env."
