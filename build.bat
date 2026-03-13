@echo off
chcp 65001 >nul
echo ========================================
echo   Luoqi Assistant 打包工具
echo ========================================
echo.

echo [1/3] 清理旧文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [2/3] 开始打包...
pyinstaller build.spec

if %errorlevel% neq 0 (
    echo.
    echo ❌ 打包失败！
    pause
    exit /b 1
)

echo [3/3] 复制外部资源...
xcopy /E /I /Y data dist\LuoqiAssistant\data
xcopy /E /I /Y assets dist\LuoqiAssistant\assets

echo.
echo ✅ 打包完成！
echo 输出目录: dist\LuoqiAssistant\
echo.
pause
