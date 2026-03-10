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
