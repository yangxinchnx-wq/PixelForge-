Set-Location 'c:\Users\yangx\Desktop\PixelForge\PixelForge\src\components\editor'

Get-ChildItem -Recurse -Filter '*.vue' | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $original = $content

    # Handle patterns WITH fallback values (var(--pf-xxx, #fff))
    $content = $content -replace 'var\(--pf-ink-faint[^)]*\)', 'var(--text-quaternary)'
    $content = $content -replace 'var\(--pf-ink-muted[^)]*\)', 'var(--text-tertiary)'
    $content = $content -replace 'var\(--pf-ink-soft[^)]*\)', 'var(--text-secondary)'
    $content = $content -replace 'var\(--pf-ink[^)]*\)', 'var(--text-primary)'
    $content = $content -replace 'var\(--pf-accent-soft[^)]*\)', 'rgba(10, 132, 255, 0.12)'
    $content = $content -replace 'var\(--pf-accent-deep[^)]*\)', 'var(--accent-pressed)'
    $content = $content -replace 'var\(--pf-accent-dark[^)]*\)', 'var(--accent-pressed)'
    $content = $content -replace 'var\(--pf-accent[^)]*\)', 'var(--accent)'
    $content = $content -replace 'var\(--pf-surface-soft[^)]*\)', 'var(--glass-bg-hover)'
    $content = $content -replace 'var\(--pf-surface-sunk[^)]*\)', 'var(--track-bg)'
    $content = $content -replace 'var\(--pf-surface[^)]*\)', 'var(--glass-bg)'
    $content = $content -replace 'var\(--pf-line-strong[^)]*\)', 'var(--separator-strong)'
    $content = $content -replace 'var\(--pf-line[^)]*\)', 'var(--separator)'
    $content = $content -replace 'var\(--pf-danger[^)]*\)', 'var(--toggle-mute)'
    $content = $content -replace 'var\(--pf-warning[^)]*\)', 'var(--toggle-solo)'
    $content = $content -replace 'var\(--pf-success[^)]*\)', 'var(--toggle-lock)'
    $content = $content -replace 'var\(--pf-info-soft[^)]*\)', 'var(--track-bg)'
    $content = $content -replace 'var\(--pf-info[^)]*\)', 'var(--text-tertiary)'
    $content = $content -replace 'var\(--pf-r-xs[^)]*\)', 'var(--radius-xs)'
    $content = $content -replace 'var\(--pf-r-sm[^)]*\)', 'var(--radius-sm)'
    $content = $content -replace 'var\(--pf-r-md[^)]*\)', 'var(--radius-md)'
    $content = $content -replace 'var\(--pf-r-lg[^)]*\)', 'var(--radius-lg)'
    $content = $content -replace 'var\(--pf-r-xl[^)]*\)', 'var(--radius-lg)'
    $content = $content -replace 'var\(--pf-paper[^)]*\)', 'var(--base-bg)'
    $content = $content -replace 'var\(--pf-bg[^)]*\)', 'var(--canvas-bg)'

    if ($content -ne $original) {
        Set-Content -Path $_.FullName -Value $content -NoNewline
        Write-Host ('Fixed: ' + $_.Name)
    }
}
