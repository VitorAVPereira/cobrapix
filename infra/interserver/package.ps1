$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$archivePath = Join-Path $projectRoot 'deploy-interserver.tar.gz'
$manifestPath = [System.IO.Path]::GetTempFileName()
# Windows bsdtar: GNU tar from Git/MSYS in PATH reads 'C:' as a remote host.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (!(Test-Path -LiteralPath $tar)) { $tar = 'tar' }
$releaseDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ciframais-release-' + [guid]::NewGuid().ToString('N'))

Push-Location $projectRoot
try {
    # Explicitly select source/build inputs. Never package local .env files,
    # certificates, node_modules, build output, databases or the frontend.
    $trackedFiles = @(git ls-files -- api-cobranca)
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao listar arquivos do backend.' }
    $backendPattern = '^api-cobranca/(src/.*\.(ts|json)|prisma/(schema\.prisma|migrations/.*)|\.dockerignore|Dockerfile|package(-lock)?\.json|prisma\.config\.js|nest-cli\.json|tsconfig(\.build)?\.json)$'
    $backendFiles = @($trackedFiles | Where-Object { $_ -match $backendPattern })
    # Files are read from the working tree but selected by git ls-files: an
    # uncommitted or untracked backend file (a new migration, for example) would be
    # silently stale or missing. Refuse instead of producing a partial release.
    $status = @(git status --porcelain --untracked-files=all -- api-cobranca)
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao verificar alteracoes do backend.' }
    $pending = @($status | ForEach-Object { ($_.Substring(3) -replace '^.* -> ', '').Trim('"') } |
        Where-Object { $_ -match $backendPattern })
    if ($pending.Count -gt 0) {
        $pending | Select-Object -First 20 | ForEach-Object { Write-Output "  pendente: $_" }
        throw "Faca commit das $($pending.Count) alteracoes do backend antes de gerar o pacote."
    }
    $commit = git rev-parse --short=12 HEAD
    if ($LASTEXITCODE -ne 0 -or !$commit) { throw 'Falha ao identificar o commit.' }
    $release = "$((Get-Date).ToUniversalTime().ToString('yyyyMMdd'))-$commit"
    $deployFiles = @(
        'infra/efi/nginx.conf',
        'infra/interserver/compose.yaml',
        'infra/interserver/compose.sh',
        'infra/interserver/setup.sh',
        'infra/interserver/init-db.sh',
        'infra/interserver/api.env.example',
        'infra/interserver/nginx.conf',
        'infra/interserver/deploy-certificate.sh',
        'infra/interserver/setup-https.sh',
        'infra/interserver/efi-ca.sha256',
        'infra/interserver/backup.sh',
        'infra/interserver/HTTPS.md',
        'infra/interserver/DATAFY.md',
        'infra/interserver/README.md'
    )
    $files = @($backendFiles + $deployFiles | Sort-Object -Unique)
    if ($backendFiles.Count -lt 10) { throw 'Lista de arquivos do backend incompleta.' }
    foreach ($file in $files) {
        if (!(Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Arquivo ausente: $file"
        }
        if ($file.EndsWith('.sh')) {
            if ([System.IO.File]::ReadAllText((Join-Path $projectRoot $file)).Contains("`r")) {
                throw "O script precisa usar finais de linha LF: $file"
            }
        }
    }
    [System.IO.File]::WriteAllLines($manifestPath, $files, [System.Text.UTF8Encoding]::new($false))
    # RELEASE identifies on the VPS which commit was deployed.
    New-Item -ItemType Directory -Path $releaseDir | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $releaseDir 'RELEASE'), "$release`n", [System.Text.UTF8Encoding]::new($false))
    # bsdtar applies -C to the -T list as well, so RELEASE is merged from its own tar.
    Push-Location $releaseDir
    try { & $tar --uname root --gname root -cf release.tar RELEASE } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar a release.' }
    & $tar -czf $archivePath -T $manifestPath "@$(Join-Path $releaseDir 'release.tar')"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o pacote.' }
    $archive = Get-Item -LiteralPath $archivePath
    Write-Output "Pacote criado: $archivePath ($($archive.Length) bytes; $($files.Count) arquivos)."
    Write-Output "Release: $release (arquivo RELEASE no pacote)"
    Write-Output "SHA256: $((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant())"
} finally {
    Pop-Location
    Remove-Item -LiteralPath $manifestPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $releaseDir -Recurse -Force -ErrorAction SilentlyContinue
}
