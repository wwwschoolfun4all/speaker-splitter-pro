param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryUrl
)

$ErrorActionPreference = "Stop"

git remote remove origin 2>$null
git remote add origin $RepositoryUrl
git branch -M main
git push -u origin main

Write-Host ""
Write-Host "Pushed Speaker Splitter Pro to GitHub."
Write-Host "Now open the repo on GitHub, then go to Settings > Pages."
Write-Host "Choose: Deploy from a branch > main > / (root)."
