@echo off
chcp 65001 >nul
title ARES-Reflect - Terminal Placement System
cd /d "%~dp0"

echo ============================================================
echo   ARES-Reflect - Terminal Yerlesim Sistemi
echo   TEKNOFEST Mobil Uydu Terminali Yarismasi
echo ============================================================
echo.

rem --- Node.js kurulu mu kontrol et ---
where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Lutfen once https://nodejs.org adresinden Node.js yukleyin.
  echo.
  pause
  exit /b 1
)

rem --- Bagimliliklar yuklu degilse yukle ---
if not exist "node_modules" (
  echo [BILGI] Bagimliliklar ilk kez yukleniyor, lutfen bekleyin...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [HATA] npm install basarisiz oldu.
    pause
    exit /b 1
  )
  echo.
)

rem --- Sunucu hazir olunca tarayiciyi otomatik ac (5 sn sonra) ---
start "" /min cmd /c "timeout /t 5 >nul && start http://localhost:5173"

echo [BILGI] Gelistirme sunucusu baslatiliyor...
echo [BILGI] Adres: http://localhost:5173
echo [BILGI] Durdurmak icin bu pencerede Ctrl+C tuslarina basin.
echo.

rem --- Vite gelistirme sunucusunu calistir (bu pencere acik kalir) ---
call npm run dev

echo.
echo [BILGI] Sunucu durduruldu.
pause
