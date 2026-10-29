# Official embeddable CPython; no installer, registry edits, pip or admin rights.
# Hashes: https://www.python.org/downloads/release/python-31410/
param([Parameter(Mandatory)][string]$Dest, [ValidateSet('x64','arm64','ia32')][string]$Arch = 'x64', [string]$ArchivePath)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$version = '3.14.10'
$packages = @{
  x64 = @('amd64', '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159')
  arm64 = @('arm64', 'bbe116bb1248820359cbf25127ac5c7794ea161869d83686cfbc9a45203ff836')
  ia32 = @('win32', '11a28e8c00a6d8f56b0a6164d52546133a9ed015a5b33e04536917e4fd6e306c')
}
$package = $packages[$Arch]
$Dest = [IO.Path]::GetFullPath($Dest)
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$target = Join-Path $Dest 'python'
$temporary = Join-Path $Dest ('python-setup-' + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $Dest ('python-previous-' + [guid]::NewGuid().ToString('N'))
$lock = $null
$movedOld = $false
$installed = $false
try {
  # An open handle releases the lock even if PowerShell is terminated.
  $lock = [IO.File]::Open((Join-Path $Dest 'python-setup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  New-Item -ItemType Directory -Path $temporary | Out-Null
  $zip = Join-Path $temporary 'python.zip'
  if ($ArchivePath) { Copy-Item -LiteralPath $ArchivePath -Destination $zip }
  else {
    $url = "https://www.python.org/ftp/python/$version/python-$version-embed-$($package[0]).zip"
    Write-Host "Downloading official CPython $version ($Arch)..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 90
  }
  if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package[1]) {
    throw 'Python SHA-256 mismatch. Installation cancelled.'
  }
  $unpacked = Join-Path $temporary 'unpacked'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
  $python = Join-Path $unpacked 'python.exe'
  & $python -I -c "import sys, sqlite3; assert sys.version_info >= (3, 8); c=sqlite3.connect(':memory:'); c.execute('select 1'); c.close()"
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded Python or SQLite cannot run.' }
  if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup; $movedOld = $true }
  try { Move-Item -LiteralPath $unpacked -Destination $target }
  catch {
    if ($movedOld) { Move-Item -LiteralPath $backup -Destination $target; $movedOld = $false }
    throw
  }
  $installed = $true
  Write-Host 'Portable Python with SQLite is ready.'
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
  if ($installed -and $movedOld) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
  if ($lock) { $lock.Dispose() }
}
