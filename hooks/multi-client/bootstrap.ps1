# Claude-Office :: bootstrap idempotente para maquina nueva.
# Lo invoca claude-stack-sync.ps1 en setup/restore/update. Seguro de re-ejecutar.
#
#   1. clona el repo si falta            4. compila dist/ (la UI la sirve el server)
#   2. npm install + aprueba nativos     5. cablea los hooks de los 5 clientes
#   3. crea office.config.json           6. instala la extension en los editores
param([switch]$Quiet, [switch]$Update)

$ErrorActionPreference = 'SilentlyContinue'
$sync = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$root = if ($env:OFFICE_HOME) { $env:OFFICE_HOME } else { Join-Path $HOME '.dev\claude-office' }
function Say($m) { if (-not $Quiet) { "  $m" } }

# --- 1. repo ---
if (-not (Test-Path (Join-Path $root 'package.json'))) {
  Say "clonando Claude-Office -> $root"
  New-Item -ItemType Directory -Force -Path (Split-Path $root) | Out-Null
  # origin = fork propio (cuenta waguirre, por SSH con el alias github-waguirreo);
  # si aun no existe, se clona del original y se corrigen los remotos despues.
  git clone git@github-waguirreo:waguirre/Claude-Office.git $root 2>&1 | Out-Null
  if (-not (Test-Path (Join-Path $root '.git'))) {
    Say '  fork no disponible, clonando del original'
    git clone git@github-waguirreo:W17ant/Claude-Office.git $root 2>&1 | Out-Null
    git -C $root remote set-url origin git@github-waguirreo:waguirre/Claude-Office.git 2>&1 | Out-Null
  }
  git -C $root remote add upstream git@github-waguirreo:W17ant/Claude-Office.git 2>&1 | Out-Null
}
if (-not (Test-Path (Join-Path $root 'package.json'))) { Say 'ERROR: no se pudo clonar'; return }

# --- 1b. actualizar desde upstream (-Update) ---
# Los parches de los pasos 4 quedan como modificaciones locales sobre el clon.
# Por eso el update hace reset duro y los REAPLICA: son idempotentes (se saltan
# si ya estan) y asi nunca hay conflicto de merge.
if ($Update) {
  Say 'actualizando (origin = waguirre/Claude-Office, upstream = W17ant/Claude-Office)'
  # Solo git, sin API: el token de `gh` es de otra cuenta. Se prefiere el fork
  # (origin); si no existe todavia, se cae al repo original (upstream).
  $src = 'origin'
  git -C $root ls-remote origin HEAD 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { $src = 'upstream'; Say '  fork no disponible, usando upstream' }
  git -C $root fetch $src 2>&1 | Out-Null
  $before = (git -C $root rev-parse HEAD)
  git -C $root reset --hard "$src/main" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { git -C $root reset --hard "$src/master" 2>&1 | Out-Null }
  $after = (git -C $root rev-parse HEAD)
  if ($before -eq $after) { Say '  ya estaba al dia' } else { Say "  $($before.Substring(0,7)) -> $($after.Substring(0,7))" }
  # forzar reinstalacion de deps y rebuild: el reset pudo cambiar package.json y src/
  Remove-Item (Join-Path $root 'dist') -Recurse -Force -ErrorAction SilentlyContinue
  npm --prefix $root install --no-audit --no-fund 2>&1 | Out-Null
}

Push-Location $root
try {
  # --- 2. dependencias (npm 12 bloquea install scripts: hay que aprobar y forzar rebuild) ---
  if (-not (Test-Path 'node_modules')) {
    Say 'npm install'
    npm install --no-audit --no-fund 2>&1 | Out-Null
  }
  if (-not (Test-Path 'node_modules\better-sqlite3\build\Release\better_sqlite3.node')) {
    Say 'compilando better-sqlite3 / esbuild'
    npm install-scripts approve better-sqlite3 2>&1 | Out-Null
    npm install-scripts approve esbuild        2>&1 | Out-Null
    npm rebuild better-sqlite3                 2>&1 | Out-Null
  }

  # --- 3. config de usuario (el repo solo trae el .example y esta gitignored) ---
  if (-not (Test-Path 'office.config.json')) {
    Say 'creando office.config.json'
    Copy-Item 'office.config.example.json' 'office.config.json'
  }

  # --- 4. parches necesarios para que compile y sirva estatico ---
  $vc = Get-Content 'vite.config.ts' -Raw
  if ($vc -notmatch "target: 'esnext'") {
    Say 'parcheando vite.config.ts (top-level await + base relativa)'
    $vc = $vc -replace "(plugins: \[react\(\)\],)", "`$1`n  base: './',`n  build: { target: 'esnext' },"
    Set-Content 'vite.config.ts' $vc -NoNewline
  }
  $si = Get-Content 'server\index.js' -Raw
  if ($si -notmatch '\[claude-sync\] Sirve la build') {
    Say 'parcheando server/index.js (servir dist/ en el mismo origen)'
    $add = "app.options('*', (_req, res) => res.sendStatus(204))`n`n" +
           "// [claude-sync] Sirve la build estatica (dist/) desde el mismo origen que la API.`n" +
           "{`n  const dist = join(__dirname, '..', 'dist')`n" +
           "  if (existsSync(dist)) app.use(express.static(dist))`n}"
    $si = $si -replace [regex]::Escape("app.options('*', (_req, res) => res.sendStatus(204))"), $add
    Set-Content 'server\index.js' $si -NoNewline
  }

  # --- 5. build ---
  if (-not (Test-Path 'dist\index.html')) {
    Say 'npm run build'
    npm run build 2>&1 | Out-Null
  }
} finally { Pop-Location }

# --- 6. hooks de los 5 clientes ---
Say 'cableando hooks (claude, codex, kimi, antigravity, opencode)'
python (Join-Path $PSScriptRoot 'install.py') 2>&1 | ForEach-Object { Say $_ }

# --- 7. extension en todos los editores Y todos sus perfiles ---
# VS Code guarda las extensiones en carpeta compartida pero cada perfil lleva su
# propio extensions.json: una extension copiada a mano solo la ve el perfil
# default. El script python registra la entrada en cada perfil.
$extInstaller = Join-Path $sync 'claude-vscode\install-extension.py'
if (Test-Path $extInstaller) {
  Say 'instalando extension de editor (todos los perfiles)'
  python $extInstaller 2>&1 | ForEach-Object { Say $_ }
}

Say 'bootstrap completo'
