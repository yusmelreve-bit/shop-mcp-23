@echo off
setlocal

if "%~1"=="" (
  echo Uso: publicar-url-produccion.bat https://tu-dominio-publico.com
  exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%~dp0publicar-url-produccion.ps1" -AppUrl "%~1"
