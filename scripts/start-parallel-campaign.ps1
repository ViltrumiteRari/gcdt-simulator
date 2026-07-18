param(
  [string]$DateList='2026-07-10,2026-07-09,2026-07-08,2026-07-07,2026-07-06',
  [int]$RunsPerDay=2,
  [double]$Speed=3,
  [int]$TailMinutes=0
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime=Join-Path $root 'runtime'
$logs=Join-Path $root 'logs\parallel'
New-Item -ItemType Directory -Force $runtime,$logs | Out-Null
$selectedDays=@($DateList.Split(',') | ForEach-Object {$_.Trim()} | Where-Object {$_})
if(-not $selectedDays.Count){throw 'NO_DATES_SELECTED'}
foreach($day in $selectedDays){
  if($day -notmatch '^\d{4}-\d{2}-\d{2}$'){throw "INVALID_REPLAY_DATE:$day"}
}
$runDates=New-Object System.Collections.Generic.List[string]
foreach($day in $selectedDays){
  for($repeat=0;$repeat -lt $RunsPerDay;$repeat++){$runDates.Add($day)}
}
$id='PAR-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$workers=@()
for($i=0;$i -lt $runDates.Count;$i++){
  $n=$i+1; $port=8800+$n; $wid="worker-$n"
  $profile=Join-Path $runtime ("profiles\$id\$wid")
  $reports=Join-Path $runtime ("run-staging\$id\$wid")
  New-Item -ItemType Directory -Force $profile,$reports | Out-Null
  $workers += [ordered]@{id=$wid;port=$port;replayDate=$runDates[$i];runNumber=$n;profile=$profile;reportFolder=$reports;status='QUEUED';provenance='STAGED_UNTRUSTED'}
}$manifest=[ordered]@{id=$id;status='STARTING';createdAt=(Get-Date).ToUniversalTime().ToString('o');speed=$Speed;runsPerDay=$RunsPerDay;selectedDates=$selectedDays;tailMinutes=$TailMinutes;workers=$workers}
$mp=Join-Path $runtime 'parallel-campaign.json'
$manifest|ConvertTo-Json -Depth 6|Set-Content -Encoding UTF8 $mp
foreach($w in $workers){
  $proc=Start-Process (Join-Path $root 'scripts\worker-launch.cmd') -PassThru -WindowStyle Hidden -ArgumentList @($w.port,('"'+$w.profile+'"'),('"'+$w.reportFolder+'"'),$id,$w.id) -RedirectStandardOutput (Join-Path $logs ($w.id+'.log')) -RedirectStandardError (Join-Path $logs ($w.id+'-error.log'))
  $w.launcherPid=$proc.Id; $w.status='STARTING'
}
$manifest.status='RUNNING';$manifest.workers=$workers
$manifest|ConvertTo-Json -Depth 6|Set-Content -Encoding UTF8 $mp
function PortOpen([int]$Port){[bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)}
$deadline=(Get-Date).AddSeconds(60)
foreach($w in $workers){
  while(-not (PortOpen $w.port)){if((Get-Date)-gt $deadline){throw "Worker $($w.id) failed"};Start-Sleep -Milliseconds 400}
  $w.pid=(Get-NetTCPConnection -LocalPort $w.port -State Listen|Select-Object -First 1 -ExpandProperty OwningProcess)
  $w.status='RUNNING';$manifest.workers=$workers
  $manifest|ConvertTo-Json -Depth 6|Set-Content -Encoding UTF8 $mp
  $body=@{name="$($w.id) $($w.replayDate)";runs=1;replayDates=@($w.replayDate);speed=$Speed;tailMinutes=$TailMinutes}|ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:$($w.port)/supervisor/campaign") -ContentType 'application/json' -Body $body|Out-Null
}
Write-Output ($manifest|ConvertTo-Json -Depth 6)