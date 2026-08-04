@echo off
setlocal

REM fixed session
set "FIXED_SESSION=preconfigured-session"

REM require IP
if "%~1"=="" (
  echo Usage: %~nx0 ^<ip^> [language]
  exit /b 1
)

set "IP=%~1"
set "LANG=%~2"
if "%LANG%"=="" set "LANG=en"

REM The client looks up its locale bundle by this exact code (variant "lang_%LANG%" in
REM assetmap.json, case-sensitive). A code that matches no bundle - a typo like "e" - loads an
REM EMPTY string table with no error, and every label in the game renders as a raw BGO.* key.
REM Validate against the 21 locale bundles the client ships, canonicalise case, and fall back
REM to en rather than let that happen.
set "LANGFOUND="
for %%L in (bg br cs da de el en es fi fr hu it nl no pl pt ro ru sk sv tr) do if /i "%LANG%"=="%%L" set "LANGFOUND=%%L"
if not defined LANGFOUND (
  echo WARNING: "%LANG%" is not a client locale ^(bg br cs da de el en es fi fr hu it nl no pl pt ro ru sk sv tr^)
  echo          Falling back to en. A wrong code loads an empty string table and every label
  echo          in the game shows as a raw BGO.* key.
  set "LANG=en"
) else (
  set "LANG=%LANGFOUND%"
)

set "PROJECT_ID=547"
set "USER_ID=1"
set "SESSION_ID=1"
set "TRACKING_ID=1"
set "VERSION=3b27980a3b7dd77e597872106ca98000"

set "CLIENT_PATH="

if exist "%~dp0.env" (
  for /f "usebackq tokens=1* delims==" %%A in ("%~dp0.env") do (
    if /i "%%A"=="CLIENT_PATH" (
      set "CLIENT_PATH=%%B"
    )
  )
)

if not defined CLIENT_PATH set "CLIENT_PATH=%~dp0client\live\bsgo.exe"

:: remove surrounding quotes if any
set "CLIENT_PATH=%CLIENT_PATH:"=%"

set "CLIENT_ARGS=+projectID %PROJECT_ID% +userID %USER_ID% +sessionID %SESSION_ID% +trackingID %TRACKING_ID% +gameServer %IP% +cdn %CLIENT_PATH% +language %LANG% +session %FIXED_SESSION% +version %VERSION%"

echo.
echo %CLIENT_ARGS%
echo.

start "" "%CLIENT_PATH%" %CLIENT_ARGS%

endlocal
exit /b 0
