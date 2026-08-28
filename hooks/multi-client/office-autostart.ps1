# Claude-Office :: autostart idempotente.
# Levanta server (3334) + UI (3333) solo si no estan ya arriba.
# Seguro de re-ejecutar: pensado para una tarea programada al iniciar sesion
# y/o un hook SessionStart. No abre el navegador (eso es decision del usuario).
#
#   pwsh -File office-autostart.ps1            # asegura que este corriendo
#   pwsh -File office-autostart.ps1 -Stop      # detiene
#   pwsh -File office-autostart.ps1 -Open      # asegura y abre el navegador
param([switch]$Stop, [switch]$Open)

$ErrorActionPreference = 'SilentlyContinue'
$root = if ($env:OFFICE_HOME) { $env:OFFICE_HOME } else { Join-Path $HOME '.dev\claude-office' }
# node puede venir de fnm: en una tarea programada el shim no esta en PATH,
# asi que se resuelve la ruta absoluta y se evita `npx` por completo.
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:APPDATA 'fnmliases\default
ode.exe' }
$viteJs = Join-Path $root 'node_modulesiteinite.js'
$log  = Join-Path $HOME '.agent-office\autostart.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Say($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Tee-Object -FilePath $log -Append }

function Up($url) {
  try { return (Invoke-WebRequest $url -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 }
  catch { return $false }
}

function Stop-Office {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$($root -replace '\','*')*" -and $_.CommandLine -match 'server.index\.js|vite' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Say "  detenido PID $($_.ProcessId)" }
}

if ($Stop) { Say 'Deteniendo Claude-Office'; Stop-Office; return }

if (-not (Test-Path $root)) { Say "ERROR: no existe $root"; return }

# --- server 3334 (IPv4) ---
if (Up 'http://127.0.0.1:3334/health') {
  Say 'server 3334 ya arriba'
} else {
  Start-Process $node -ArgumentList @('server/index.js') -WorkingDirectory $root -WindowStyle Hidden
  $ok = $false
  foreach ($i in 1..20) { Start-Sleep -Milliseconds 400; if (Up 'http://127.0.0.1:3334/health') { $ok = $true; break } }
  Say $(if ($ok) { 'server 3334 levantado' } else { 'ERROR: server 3334 no respondio' })
}

# La UI ya la sirve el propio server en 3334 (build estatica en dist/).
# Vite solo hace falta para desarrollo del front; se dejo fuera del arranque
# porque no sobrevive a una consola padre que se cierra.
if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Say 'AVISO: falta dist/ -> correr `npm run build` en el repo'
}

if ($Open) { Start-Process 'http://localhost:3334' }
