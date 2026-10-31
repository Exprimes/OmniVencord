# OmniInstaller - installe / met à jour / désinstalle OmniVencord (Vencord + plugins Omni).
# Fait la même chose que "pnpm inject", mais avec la dernière build publiée sur GitHub :
# Vencord se mettra ensuite à jour tout seul depuis ce dépôt (bouton "Mettre à jour").

$Repo = "Exprimes/OmniVencord"
$Dir = Join-Path $env:APPDATA "OmniVencord"
$Dist = Join-Path $Dir "dist"
$Cli = Join-Path $Dir "VencordInstallerCli.exe"
$Files = "patcher.js", "preload.js", "renderer.js", "renderer.css"

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Headers = @{ "User-Agent" = "OmniInstaller" }

function Stop-Discord {
    Get-Process Discord, DiscordPTB, DiscordCanary -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

function Get-InstallerCli {
    New-Item -ItemType Directory -Force $Dir | Out-Null
    Invoke-WebRequest "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" -OutFile $Cli -Headers $Headers
}

function Invoke-InstallerCli([string[]]$CliArgs) {
    # Indique à l'installateur officiel d'utiliser notre dossier dist au lieu de la build Vencord officielle
    $env:VENCORD_USER_DATA_DIR = $Dir
    $env:VENCORD_DEV_INSTALL = "1"
    & $Cli @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "L'installateur Vencord a échoué (code $LASTEXITCODE)." }
}

function Install-Omni {
    Write-Host "Téléchargement de la dernière version d'OmniVencord..." -ForegroundColor Cyan
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers $Headers
    New-Item -ItemType Directory -Force $Dist | Out-Null
    foreach ($name in $Files) {
        $asset = $release.assets | Where-Object name -eq $name
        if (-not $asset) { throw "Fichier $name introuvable dans la release $($release.name)." }
        Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $Dist $name) -Headers $Headers
    }

    Get-InstallerCli
    Stop-Discord
    Write-Host "Installation dans Discord..." -ForegroundColor Cyan
    Invoke-InstallerCli @("-install", "-branch", "auto")
    Write-Host "`nOmniVencord ($($release.name)) est installé !" -ForegroundColor Green
}

function Uninstall-Omni {
    if (-not (Test-Path $Cli)) { Get-InstallerCli }
    Stop-Discord
    Invoke-InstallerCli @("-uninstall", "-branch", "auto")
    Remove-Item -Recurse -Force $Dir
    Write-Host "`nOmniVencord a été désinstallé." -ForegroundColor Green
}

function Start-Discord {
    $update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
    if (Test-Path $update) { Start-Process $update -ArgumentList "--processStart", "Discord.exe" }
}

Write-Host "==============================" -ForegroundColor Magenta
Write-Host "        OmniInstaller" -ForegroundColor Magenta
Write-Host "==============================" -ForegroundColor Magenta
Write-Host "Discord va être fermé pendant l'opération.`n"
Write-Host "1) Installer / Réparer OmniVencord"
Write-Host "2) Désinstaller OmniVencord"
$choice = Read-Host "`nTon choix (1 ou 2)"

try {
    switch ($choice) {
        "1" { Install-Omni }
        "2" { Uninstall-Omni }
        default { Write-Host "Choix invalide, rien n'a été fait."; exit 1 }
    }
    Start-Discord
} catch {
    Write-Host "`nErreur : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Ferme complètement Discord et relance OmniInstaller. Si ça continue, envoie une capture à Exprimes."
}

Read-Host "`nAppuie sur Entrée pour fermer"
