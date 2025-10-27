@echo off
REM fix-asset-paths.bat
REM Windows batch script to fix asset paths in HTML files
REM This ensures the frontend loads correctly in packaged apps

echo Fixing asset paths in HTML files...

REM Find all index.html files in the renderer dist directory
for /r "electron\renderer\dist" %%f in (index.html) do (
    echo Processing: %%f
    
    REM Create a temporary file
    set "tempfile=%%f.tmp"
    
    REM Replace absolute paths with relative paths using PowerShell
    powershell -Command "(Get-Content '%%f') -replace 'src=\"/assets/', 'src=\"./assets/' -replace 'href=\"/assets/', 'href=\"./assets/' | Set-Content '%tempfile%'"
    
    REM Replace the original file with the fixed version
    move "%tempfile%" "%%f"
    
    echo Fixed asset paths in %%f
)

echo Asset path fixing completed!
