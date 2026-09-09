# Coloca o Node portatil do projeto no PATH da sessao atual do PowerShell.
# Uso (com o ponto na frente, para valer na sessao atual):  . .\scripts\use-node.ps1
$node = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\node'
if (-not (Test-Path (Join-Path $node 'node.exe'))) {
  Write-Warning "Node portatil nao encontrado em $node. Rode: powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1"
  return
}
$env:Path = "$node;$env:Path"
Write-Host "Usando Node $(& (Join-Path $node 'node.exe') --version) de $node"
