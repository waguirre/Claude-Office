# Claude-Office :: arranque en Windows.
# Reemplaza scripts/start-office.sh, que usa `open` y `pkill -f` (solo macOS/Unix).
#   pwsh -File start-office.ps1          # levanta server + UI y abre el navegador
#   pwsh -File start-office.ps1 -Stop    # detiene ambos
param([switch]$Stop)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = 'SilentlyContinue'

function Stop-Office {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'server[\/]index\.js|vite' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "  detenido PID $($_.ProcessId)" }
}

if ($Stop) { "Deteniendo Claude-Office..."; Stop-Office; return }

Stop-Office | Out-Null

Start-Process node -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Hidden
foreach ($i in 1..20) {
  Start-Sleep -Milliseconds 400
  if ((Invoke-WebRequest 'http://127.0.0.1:3334/health' -TimeoutSec 2).StatusCode -eq 200) { break }
}
"  server  http://127.0.0.1:3334"

Start-Process npx -ArgumentList 'vite','--port','3333','--strictPort' -WorkingDirectory $root -WindowStyle Hidden
# Vite bindea solo IPv6: sondear localhost, nunca 127.0.0.1.
foreach ($i in 1..25) {
  Start-Sleep -Milliseconds 400
  if ((Invoke-WebRequest 'http://localhost:3333' -TimeoutSec 2).StatusCode -eq 200) { break }
}
"  UI      http://localhost:3333"

Start-Process 'http://localhost:3333'
