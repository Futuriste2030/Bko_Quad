# BKO Quad Hub — lancement démo (IP dynamique, résiste au reboot/DHCP).
# Usage : clic droit > Exécuter avec PowerShell, ou : powershell -ExecutionPolicy Bypass -File demarrer-demo.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 1. IP locale actuelle (Wi-Fi / Ethernet), ignoré loopback et APIPA.
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Sort-Object { if ($_.IPAddress -like '192.168.*') {0} elseif ($_.IPAddress -like '10.*') {1} else {2} } |
  Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $ip) { $ip = '192.168.1.22' }

Write-Host ''
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host "  BKO Quad Hub — IP PC : $ip" -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host "  PWA (PC)        : https://localhost:5173/"
Write-Host "  PWA (téléphone, même Wi-Fi) : https://${ip}:5173/"
Write-Host "  Dans l’APK, si page blanche : triple appui volume-bas >"
Write-Host "  reconfigurer Adresse du Hub = https://${ip}:5173/ (avec le / final)"
Write-Host "  (accepter l’avertissement certificat auto-signé : normal en démo)"
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host ''

# 2. Backend Django sur toutes les interfaces (0.0.0.0) — le proxy Vite /api vise 127.0.0.1, inchangé.
$backend = Start-Process -PassThru -WindowStyle Normal powershell -ArgumentList '-NoExit','-Command', "Set-Location '$root'; python backend\manage.py runserver 0.0.0.0:8000"

# 3. Frontend Vite accessible LAN (host:true déjà dans vite.config.ts).
$frontend = Start-Process -PassThru -WindowStyle Normal powershell -ArgumentList '-NoExit','-Command', "Set-Location '$root\frontend'; npm run dev -- --host"

Write-Host "Backend PID $($backend.Id) | Frontend PID $($frontend.Id)"
Write-Host 'Laissez les 2 fenêtres ouvertes pendant la démo.'

# 4. Clôture automatique de la journée à 20h00 (décision I) : worker + beat Celery.
#    Ils ont besoin de Redis. Sans Redis, la clôture se rattrape dès que l'écran
#    /cloture est consulté après 20h (repli serveur : jamais de bouton manuel).
$redis = $false
try { $tcp = New-Object System.Net.Sockets.TcpClient; $tcp.Connect('127.0.0.1', 6379); $redis = $true; $tcp.Close() } catch { $redis = $false }

if ($redis) {
  $worker = Start-Process -PassThru -WindowStyle Normal powershell -ArgumentList '-NoExit','-Command', "Set-Location '$root\backend'; python -m celery -A config worker -l info --pool=solo"
  $beat = Start-Process -PassThru -WindowStyle Normal powershell -ArgumentList '-NoExit','-Command', "Set-Location '$root\backend'; python -m celery -A config beat -l info"
  Write-Host "Celery worker PID $($worker.Id) | beat PID $($beat.Id) — fenêtres à laisser ouvertes (clôture 20h00)."
} else {
  Write-Host 'Redis absent (port 6379) : worker et beat non lancés.' -ForegroundColor Yellow
  Write-Host '  La clôture de 20h00 se fera automatiquement à la consultation de /cloture.'
}
