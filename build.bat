@echo off
setlocal
chcp 65001 >nul
echo ========================================
echo   Luoqi Assistant 打包工具
echo ========================================
echo.

echo [1/4] 清理旧文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [2/4] 构建前端...
pushd app\ui
if not exist node_modules (
    echo   安装前端依赖...
    call npm install --silent
    if %errorlevel% neq 0 (
        echo.
        echo ❌ npm install 失败！
        popd
        pause
        exit /b 1
    )
)
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo ❌ 前端构建失败！
    popd
    pause
    exit /b 1
)
popd

echo [3/4] 开始打包...
pyinstaller build.spec
if %errorlevel% neq 0 (
    echo.
    echo ❌ PyInstaller 打包失败！
    pause
    exit /b 1
)

if not exist dist\LuoqiAssistant (
    echo.
    echo ❌ 未找到输出目录 dist\LuoqiAssistant\
    pause
    exit /b 1
)

echo [4/4] 复制外部资源...
if exist data (
    xcopy /E /I /Y data dist\LuoqiAssistant\data
    if %errorlevel% geq 4 (
        echo.
        echo ❌ 复制 data 目录失败！
        pause
        exit /b 1
    )
)
if exist assets (
    xcopy /E /I /Y assets dist\LuoqiAssistant\assets
    if %errorlevel% geq 4 (
        echo.
        echo ❌ 复制 assets 目录失败！
        pause
        exit /b 1
    )
)

echo.
echo ✅ 打包完成！
echo 输出目录: dist\LuoqiAssistant\
echo 请分发整个目录，不要只拿单个 exe 文件。
echo.
pause
