[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Set-Location -LiteralPath $PSScriptRoot

function Test-WebviewDependency {
    param([string]$PythonCommand)

    & $PythonCommand -c "import webview" > $null 2> $null
    return $LASTEXITCODE -eq 0
}

function Wait-AndExit {
    param([int]$ExitCode)

    if ($ExitCode -ne 0) {
        Read-Host '按回车退出' | Out-Null
    }

    exit $ExitCode
}

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
$pythonCommand = $null
$pythonLabel = $null

if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
    if (Test-WebviewDependency -PythonCommand $venvPython) {
        $pythonCommand = $venvPython
        $pythonLabel = '.venv\Scripts\python.exe'
    }
}

if (-not $pythonCommand) {
    $pythonInfo = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonInfo) {
        Write-Host ''
        Write-Host '[Luoqi] 未找到可用的 Python。'
        Write-Host '[Luoqi] 请先安装 Python 3.13+，然后重试。'
        Wait-AndExit -ExitCode 1
    }

    if (-not (Test-WebviewDependency -PythonCommand 'python')) {
        Write-Host ''
        Write-Host '[Luoqi] 找到了 Python，但缺少运行依赖。'
        Write-Host '[Luoqi] 请先执行：'
        Write-Host '    python -m pip install -r requirements.txt'
        Wait-AndExit -ExitCode 1
    }

    $pythonCommand = 'python'
    $pythonLabel = 'python'
}

# ── 前端构建 ──
$uiDir = Join-Path $PSScriptRoot 'app\ui'
$distIndex = Join-Path $uiDir 'dist\index.html'
$srcDir = Join-Path $uiDir 'src'

# 判断是否需要重新构建：dist 不存在，或 src 比 dist 更新
$needBuild = $false
if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
    $needBuild = $true
} else {
    $distTime = (Get-Item -LiteralPath $distIndex).LastWriteTime
    $newerFiles = Get-ChildItem -Path $srcDir -Recurse -File |
        Where-Object { $_.LastWriteTime -gt $distTime }
    if ($newerFiles) {
        $needBuild = $true
    }
}

if ($needBuild) {
    if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
        Write-Host '[Luoqi] 首次运行，需要构建前端...'
    } else {
        Write-Host '[Luoqi] 检测到前端源码变更，重新构建...'
    }

    $npmInfo = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmInfo) {
        Write-Host ''
        Write-Host '[Luoqi] 未找到 npm，请先安装 Node.js 16+。'
        Wait-AndExit -ExitCode 1
    }

    $nodeModules = Join-Path $uiDir 'node_modules'
    if (-not (Test-Path -LiteralPath $nodeModules -PathType Container)) {
        Write-Host '[Luoqi] 安装前端依赖...'
        Push-Location -LiteralPath $uiDir
        & npm install --silent
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Host '[Luoqi] npm install 失败。'
            Wait-AndExit -ExitCode 1
        }
        Pop-Location
    }

    Write-Host '[Luoqi] 构建前端...'
    Push-Location -LiteralPath $uiDir
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Host '[Luoqi] 前端构建失败。'
        Wait-AndExit -ExitCode 1
    }
    Pop-Location
    Write-Host '[Luoqi] 前端构建完成。'
}

Write-Host '[Luoqi] 正在启动桌面程序...'
& $pythonCommand 'main.py'
$exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }

if ($exitCode -ne 0) {
    Write-Host ''
    Write-Host "[Luoqi] 启动失败，退出码：$exitCode"
    Write-Host '[Luoqi] 若是首次运行，请先执行：'
    Write-Host "    $pythonLabel -m pip install -r requirements.txt"
    Wait-AndExit -ExitCode $exitCode
}

Wait-AndExit -ExitCode 0
