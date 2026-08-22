# GATA - push a repository to every place it is mirrored, and be honest about it.
#
# Dot-source this and call Publish-Repo.
#
# Why it exists: a remote can carry SEVERAL push URLs (here: Gitea first, then
# GitHub). "git push origin main" walks them in order and reports failure if
# ANY of them fails - so a Gitea login that has expired made the whole push
# look failed, and the copy on GitHub (the one the apps actually read) never
# went out. A release then existed on this PC, showed up in the Release
# Manager's list, and was invisible to every customer.
#
# So: push URL BY URL. The one the apps read must succeed; a mirror that
# refuses is a warning, not a failure.

function Publish-Repo {
    param(
        [Parameter(Mandatory = $true)] [string]$RepoDir,
        [Parameter(Mandatory = $true)] [string]$Message,
        # The URL customers actually read from. Pushing here MUST work.
        [string]$PrimaryMatch = "github.com",
        [string]$Branch = "main"
    )

    if (-not (Test-Path (Join-Path $RepoDir ".git"))) {
        Write-Host "Not a git repository: $RepoDir - nothing to publish." -ForegroundColor Yellow
        return $true
    }

    Push-Location $RepoDir
    try {
        [Environment]::CurrentDirectory = $RepoDir
        # git writes ordinary notices to stderr; in PowerShell 5.1 that becomes
        # an ErrorRecord and would abort the caller. Judge git by exit codes.
        $ErrorActionPreference = "Continue"

        if (& git status --porcelain) {
            & git -c core.safecrlf=false add -A
            & git -c core.safecrlf=false commit -q -m $Message
            if ($LASTEXITCODE -ne 0) { Write-Host "git commit failed." -ForegroundColor Red; return $false }
        }

        # every push URL of every remote, in order, de-duplicated
        $urls = @()
        foreach ($remote in (& git remote)) {
            foreach ($u in (& git remote get-url --push --all $remote)) {
                if ($u -and ($urls -notcontains $u)) { $urls += $u }
            }
        }
        if (-not $urls) { Write-Host "No push URL configured." -ForegroundColor Red; return $false }

        $primaryOk = $false
        $anyOk = $false
        foreach ($u in $urls) {
            $isPrimary = $u -like "*$PrimaryMatch*"
            & git push -q $u $Branch 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $anyOk = $true
                if ($isPrimary) { $primaryOk = $true }
                Write-Host ("  pushed to " + $u) -ForegroundColor Green
            } elseif ($isPrimary) {
                Write-Host ("  FAILED to push to " + $u) -ForegroundColor Red
            } else {
                # a mirror nobody downloads from - worth saying, not worth failing
                Write-Host ("  mirror refused (" + $u + ") - customers are not affected.") -ForegroundColor Yellow
            }
        }

        if ($primaryOk) { return $true }
        if (-not ($urls | Where-Object { $_ -like "*$PrimaryMatch*" })) {
            # no primary configured at all - any success will have to do
            return $anyOk
        }
        return $false
    } finally { Pop-Location }
}
