# Baixa o Node 24 LTS portátil para .tools\node SEM alterar o Node global da máquina.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1
$ErrorActionPreference = 'Stop'

$Versao  = 'v24.20.0'
$Sha256  = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
$Nome    = "node-$Versao-win-x64"
$Url     = "https://nodejs.org/dist/$Versao/$Nome.zip"

$Raiz    = Split-Path -Parent $PSScriptRoot
$Tools   = Join-Path $Raiz '.tools'
$Destino = Join-Path $Tools 'node'
$NodeExe = Join-Path $Destino 'node.exe'

if (Test-Path $NodeExe) {
  $atual = (& $NodeExe --version).Trim()
  if ($atual -eq $Versao) {
    Write-Host "Node $atual ja instalado em $Destino"
    exit 0
  }
  Write-Host "Substituindo Node $atual por $Versao..."
  Remove-Item -Recurse -Force $Destino
}

New-Item -ItemType Directory -Force $Tools | Out-Null
$Zip = Join-Path $Tools "$Nome.zip"

Write-Host "Baixando $Url ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

$hash = (Get-FileHash -Path $Zip -Algorithm SHA256).Hash
if ($hash -ine $Sha256) {
  Remove-Item $Zip
  throw "SHA-256 do download nao confere. Esperado $Sha256, obtido $hash"
}

Write-Host "Extraindo..."
Expand-Archive -Path $Zip -DestinationPath $Tools -Force
Rename-Item -Path (Join-Path $Tools $Nome) -NewName 'node'
Remove-Item $Zip

Write-Host "Node $(& $NodeExe --version) instalado em $Destino"
Write-Host "npm $(& (Join-Path $Destino 'npm.cmd') --version)"
Write-Host ""
Write-Host "No VS Code, abra um NOVO terminal deste projeto (o PATH ja aponta para .tools\node)."
Write-Host "Em outros terminais rode:  . .\scripts\use-node.ps1"
