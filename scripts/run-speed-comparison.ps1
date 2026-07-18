$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$id='SPEED-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$specs=@(
  @{speed=3;port=8811;wid='speed-3x'},
  @{speed=6;port=8812;wid='speed-6x'},
  @{speed=7;port=8813;wid='speed-7x'}
)
$workers=@()
foreach($s in $specs){
  $profile=Join-Path $root "runtime\profiles\$id\$($s.wid)"
  $reports=Join-Path $root "runtime\speed-tests\$id\$($s.wid)"
  New-Item -ItemType Directory -Force $profile,$reports|Out-Null
  $p=Start-Process (Join-Path $root 'scripts\worker-launch.cmd') -PassThru -WindowStyle Hidden -ArgumentList @($s.port,('"'+$profile+'"'),('"'+$reports+'"'),$id,$s.wid)
  $workers += [ordered]@{id=$s.wid;speed=$s.speed;port=$s.port;profile=$profile;reportFolder=$reports;launcherPid=$p.Id;status='STARTING'}
}
$manifest=[ordered]@{id=$id;status='STARTING';replayDate='2026-07-07';createdAt=(Get-Date).ToUniversalTime().ToString('o');workers=$workers}
$mp=Join-Path $root 'runtime\speed-comparison.json'
$manifest|ConvertTo-Json -Depth 6|Set-Content -Encoding UTF8 $mp
foreach($w in $workers){
  $deadline=(Get-Date).AddSeconds(60)
  while(-not (Get-NetTCPConnection -LocalPort $w.port -State Listen -ErrorAction SilentlyContinue)){
    if((Get-Date)-gt $deadline){throw "PORT_TIMEOUT_$($w.port)"}
    Start-Sleep -Milliseconds 400
  }
  $w.pid=(Get-NetTCPConnection -LocalPort $w.port -State Listen|Select-Object -First 1 -ExpandProperty OwningProcess)
  $body=@{name="$($w.id) 2026-07-07";runs=1;replayDates=@('2026-07-07');speed=$w.speed;tailMinutes=0}|ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($w.port)/supervisor/campaign" -ContentType 'application/json' -Body $body|Out-Null
  $w.status='RUNNING'
  $manifest.workers=$workers
  $manifest.status='RUNNING'
  $manifest|ConvertTo-Json -Depth 6|Set-Content -Encoding UTF8 $mp
}
Write-Output ($manifest|ConvertTo-Json -Depth 6)
