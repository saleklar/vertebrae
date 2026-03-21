// PowerShell script to run Spine CLI and extract JSON
param(
  [string]$SpineFilePath,
  [string]$OutputJsonPath
)

# Path to Spine CLI executable
$SpineCliPath = "spine" # Update if needed

# Run Spine CLI export
& $SpineCliPath --export --output $OutputJsonPath $SpineFilePath
if ($LASTEXITCODE -eq 0) {
  Write-Host "Spine JSON exported successfully to $OutputJsonPath"
} else {
  Write-Host "Spine CLI export failed."
}
