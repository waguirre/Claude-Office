# Claude-Office :: crear el fork en la cuenta waguirre y mapear remotos por SSH.
#
# Forkear es una operacion de API: la clave SSH NO basta (sirve para push/pull,
# no para crear repos). Por eso hace falta que `gh` este autenticado como
# waguirre. Si el token activo es de otra cuenta, este script lo detecta y para.
#
#   gh auth login                 # una vez, como waguirre
#   pwsh -File fork-setup.ps1
param([string]$Account = 'waguirre',
      [string]$Upstream = 'W17ant/Claude-Office',
      [string]$SshAlias = 'github-waguirreo')

$ErrorActionPreference = 'Continue'
$root = if ($env:OFFICE_HOME) { $env:OFFICE_HOME } else { Join-Path $HOME '.dev\claude-office' }
$repo = ($Upstream -split '/')[-1]
$forkUrl = "git@${SshAlias}:${Account}/${repo}.git"
$upUrl   = "git@${SshAlias}:${Upstream}.git"

function Exists { git ls-remote $forkUrl HEAD 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) }

# 1. ¿Ya existe? Entonces solo hay que mapear.
if (Exists) {
  "  fork ya existe: $Account/$repo"
} else {
  # 2. Verificar que gh actua como la cuenta correcta ANTES de forkear,
  #    para no crear el fork en la cuenta equivocada (paso dificil de deshacer:
  #    borrar repos esta prohibido por regla global).
  $who = (gh api user --jq .login 2>$null)
  if (-not $who) {
    "  ERROR: gh no esta autenticado. Ejecuta:  gh auth login"; return
  }
  if ($who -ne $Account) {
    "  ERROR: gh esta autenticado como '$who', no como '$Account'."
    "         El fork se crearia en la cuenta equivocada. Ejecuta:  gh auth login"
    "         (o limpia GITHUB_TOKEN, que tiene prioridad sobre la sesion guardada)"
    return
  }
  "  forkeando $Upstream -> $Account ..."
  gh repo fork $Upstream --clone=false --remote=false 2>&1 | Out-Null
  foreach ($i in 1..15) { Start-Sleep -Seconds 2; if (Exists) { break } }
  if (-not (Exists)) { "  ERROR: el fork no aparecio tras 30s"; return }
  "  fork creado"
}

# 3. Mapear remotos del clon local por SSH.
if (Test-Path (Join-Path $root '.git')) {
  git -C $root remote set-url origin $forkUrl 2>&1 | Out-Null
  git -C $root remote remove upstream 2>&1 | Out-Null
  git -C $root remote add upstream $upUrl 2>&1 | Out-Null
} else {
  "  clonando desde el fork..."
  git clone $forkUrl $root 2>&1 | Out-Null
  git -C $root remote add upstream $upUrl 2>&1 | Out-Null
}

# 3b. Identidad de commits PARA ESTE REPO. Sin esto se hereda la global, que es
#     la cuenta de trabajo, y los commits al fork personal quedan mal atribuidos.
#     Se usa el correo noreply de GitHub: atribuye bien sin exponer email real.
$uid = (gh api "users/$Account" --jq .id 2>$null)
if ($uid) {
  git -C $root config user.name  $Account
  git -C $root config user.email "$uid+$Account@users.noreply.github.com"
  "  identidad local: $Account <$uid+$Account@users.noreply.github.com>"
} else {
  "  AVISO: no se pudo resolver el id de $Account; revisa git config user.email a mano"
}

# 4. Publicar en el fork lo que haya en local (por si se clono del original).
git -C $root push -u origin HEAD 2>&1 | Out-Null

"  origin   -> $forkUrl"
"  upstream -> $upUrl"
"  listo. Actualizar con: bootstrap.ps1 -Update"
