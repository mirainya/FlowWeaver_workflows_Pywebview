@echo off
chcp 65001 >nul
echo [Luoqi] 构建前端...

pushd "%~dp0app\ui"

if not exist node_modules (
    echo [Luoqi] 安装前端依赖...
    call npm install --silent
    if %errorlevel% neq 0 (
        echo [Luoqi] npm install 失败！
        pause
        exit /b 1
    )
)

call npm run build
if %errorlevel% neq 0 (
    echo [Luoqi] 前端构建失败！
    pause
    exit /b 1
)

popd
echo [Luoqi] 前端构建完成。
