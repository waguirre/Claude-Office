# Claude-Office :: arranque en Windows.
# Reemplaza scripts/start-office.sh, que usa `open` y `pkill -f` (solo macOS/Unix).
#   pwsh -File start-office.ps1              # levanta server + UI y abre el navegador
#   pwsh -File start-office.ps1 -NoBrowser   # igual, sin abrir el navegador (autostart)
#   pwsh -File start-office.ps1 -Stop        # detiene ambos
param([switch]$Stop, [switch]$NoBrowser)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = 'SilentlyContinue'

# TcpClient y no Invoke-WebRequest: el sondeo corre en bucle y no hace falta
# el cuerpo de la respuesta, solo saber si alguien escucha.
function Test-Puerto([string]$Host_, [int]$Port) {
  $c = [Net.Sockets.TcpClient]::new()
  try { $c.ConnectAsync($Host_, $Port).Wait(400) -and $c.Connected } catch { $false } finally { $c.Dispose() }
}

function Wait-Puerto([string]$Host_, [int]$Port, [int]$Intentos) {
  foreach ($i in 1..$Intentos) {
    if (Test-Puerto $Host_ $Port) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Stop-Office {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'server[\/]index\.js|vite' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "  detenido PID $($_.ProcessId)" }
}

if ($Stop) { "Deteniendo Claude-Office..."; Stop-Office; return }

Stop-Office | Out-Null

Start-Process node -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
$serverOk = Wait-Puerto '127.0.0.1' 3334 20
if ($serverOk) { "  server  http://127.0.0.1:3334" }
else           { Write-Warning "  server  NO levanto en 3334 (revisar: node server/index.js)" }

# `npx` a secas resuelve al ExternalScript npx.ps1, que Start-Process no puede
# ejecutar ("%1 is not a valid Win32 application"), y con ErrorActionPreference
# SilentlyContinue el fallo era invisible: la UI nunca arrancaba pero el script
# igual imprimia su URL. Hay que invocar el .cmd. La ruta de fnm cambia por
# shell (fnm_multishells/<pid>_<ts>), asi que se resuelve en runtime.
$npx = (Get-Command npx.cmd -ErrorAction SilentlyContinue).Source
if (-not $npx) {
  Write-Warning "  UI      npx.cmd no esta en PATH -- UI omitida."
} else {
  Start-Process $npx -ArgumentList 'vite','--port','3333','--strictPort' -WorkingDirectory $root -WindowStyle Hidden
  # Vite bindea solo IPv6: sondear localhost, nunca 127.0.0.1.
  if (Wait-Puerto 'localhost' 3333 25) {
    "  UI      http://localhost:3333"
    if (-not $NoBrowser) { Start-Process 'http://localhost:3333' }
  } else {
    Write-Warning "  UI      NO levanto en 3333 (revisar: npx vite --port 3333)"
  }
}
