# =====================================================================
#  ZD Licensing - set up the SharePoint site, lists and libraries
#
#  WHAT IT DOES (it pauses before each step - press Enter to go on):
#    1. Creates the site /sites/ZD_POC (private, no Microsoft 365 group)
#       - skipped if it exists
#    2. Creates the lists:  ZD_Holders, ZD_Licences, ZD_Firearms (old), ZD_Staff, ZD_Activity, ZD_Codes
#    3. Creates the libraries:  ZD_LicencePhotos, ZD_CardBackgrounds, ZD_Documents
#    4. Creates the SharePoint group "ZD Licensing Office" with Edit rights
#       and adds you to it
#    No other site, list or group is touched.
#
#  SAFE TO RE-RUN: every step checks first and skips what already exists
#  (missing columns are added to lists that are already there).
#
#  LATER, FOR ZD SYSTEMS' OWN TENANT: change the five settings below
#  ($TenantName, $SitePath, $ClientId, $Owner, $TenantId), run it again
#  there, then give zd-config.js the new values. -Prefix stays "ZD_".
#
#  NEEDS: PowerShell 7 and PnP.PowerShell (the same set-up as before).
#  If a step shows red text, stop and send Claude a screenshot.
# =====================================================================

$ErrorActionPreference = "Stop"

$TenantName  = "conceptcompg"
$SitePath    = "/sites/ZD_POC"
$ClientId    = "38ab6537-f037-49a3-9837-af7aab9b5ca1"   # your PnP app registration
$Owner       = "mscully@concept.com.pg"
$TenantId    = "ea9e105c-2df6-47ef-a8e3-b4aa1d788423"
$Prefix      = "ZD_"
$OfficeGroup = "ZD Licensing Office"

$SiteUrl  = "https://$TenantName.sharepoint.com$SitePath"
$AdminUrl = "https://$TenantName-admin.sharepoint.com"

function Pause-Step($text) {
    Write-Host ""
    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $text -ForegroundColor Cyan
    Read-Host "Press Enter to continue (or Ctrl+C to stop)" | Out-Null
}
function Ok($text)   { Write-Host "  OK  $text" -ForegroundColor Green }
function Skip($text) { Write-Host "  --  $text (already there)" -ForegroundColor DarkYellow }

Import-Module PnP.PowerShell

# ---------------------------------------------------------------------
Pause-Step "STEP 1 of 4 - Create the site $SitePath (you'll be asked to sign in)"
Connect-PnPOnline -Url $AdminUrl -Interactive -ClientId $ClientId
$site = $null
try { $site = Get-PnPTenantSite -Identity $SiteUrl -ErrorAction Stop } catch { $site = $null }
if ($site) {
    Skip "Site $SiteUrl"
} else {
    Write-Host "  Creating the site - this can take a minute or two..."
    New-PnPSite -Type TeamSiteWithoutMicrosoft365Group -Title "ZD Licensing (POC)" -Url $SiteUrl -Owner $Owner -Wait | Out-Null
    Ok "Site created: $SiteUrl"
}

Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# Helpers ---------------------------------------------------------------
function Ensure-List($name, $template, $description) {
    $found = $null; try { $found = Get-PnPList -Identity $name -ErrorAction Stop } catch { $found = $null }
    if ($found) { Skip "List $name"; return }
    New-PnPList -Title $name -Url $name -Template $template -EnableVersioning | Out-Null
    Set-PnPList -Identity $name -Description $description | Out-Null
    Ok "List $name"
}
# Plain text column ("Text", up to 255) or long text ("Note") or number ("Number")
function Ensure-Field($list, $name, $type, [switch]$Indexed) {
    $f = $null; try { $f = Get-PnPField -List $list -Identity $name -ErrorAction Stop } catch { $f = $null }
    if ($f) { Skip "  $list.$name" }
    else {
        Add-PnPField -List $list -DisplayName $name -InternalName $name -Type $type -AddToDefaultView | Out-Null
        Ok "  $list.$name"
    }
    if ($Indexed) { Set-PnPField -List $list -Identity $name -Values @{ Indexed = $true } | Out-Null }
}
function Set-TitleName($list, $label) {
    Set-PnPField -List $list -Identity "Title" -Values @{ Title = $label } | Out-Null
}

# ---------------------------------------------------------------------
Pause-Step "STEP 2 of 4 - Create the lists ${Prefix}Holders, ${Prefix}Licences, ${Prefix}Firearms, ${Prefix}Staff, ${Prefix}Activity, ${Prefix}Codes"
# Dates are stored as plain text YYYY-MM-DD (no time-zone shift), like the other Hubs.

# Licence holders - a person, or a company (with its owner / CEO). Photo and face record belong here.
$H = "${Prefix}Holders"
Ensure-List $H "GenericList" "Licence holders - one row per person (ZD Licensing app)"
Set-TitleName $H "Name"
foreach ($c in "Surname","GivenNames","MiddleName","DateOfBirth","Sex","Phone","Email","PhotoItemId","PhotoDate",
               "FaceId","FaceStatus","FaceDate","CapturedBy") { Ensure-Field $H $c "Text" }
# Company holders: the company's details (the person fields hold its owner / CEO)
foreach ($c in "HolderKind","CompanyName","CompanyRegNo","RepRole") { Ensure-Field $H $c "Text" }
foreach ($c in "Address","Notes","PhotoUrl","FaceNote") { Ensure-Field $H $c "Note" }
Ensure-Field $H "ClientRef" "Text" -Indexed

# Licences - one per firearm, each with its own number, purpose, dates and card
$L = "${Prefix}Licences"
Ensure-List $L "GenericList" "Firearms licences - one row per licence = one firearm (ZD Licensing app)"
Set-TitleName $L "Licence no"
foreach ($c in "Surname","GivenNames","DateOfBirth","Sex","Phone","Email","LicenceType","LicenceStatus",
               "IssueDate","ExpiryDate","PhotoItemId","PhotoDate","FaceId","FaceStatus","FaceDate",
               "CardBackground","CardOrientation","LastPrinted","CapturedBy") { Ensure-Field $L $c "Text" }
foreach ($c in "Address","Notes","PhotoUrl","FaceNote") { Ensure-Field $L $c "Note" }
Ensure-Field $L "PrintCount" "Number"
foreach ($c in "SerialNo","Make","Model","FirearmType","Calibre","Purpose","Class","BarcodeNo") { Ensure-Field $L $c "Text" }
# Licences to carry (LTC): the person carrying one of the company's firearms
foreach ($c in "CarrierSurname","CarrierGivenNames","CarrierMiddleName","CarrierDOB","CarrierSex","CarrierPhone") { Ensure-Field $L $c "Text" }
Ensure-Field $L "CarrierAddress" "Note"
Ensure-Field $L "CarryForRef" "Text" -Indexed
Ensure-Field $L "HolderRef" "Text" -Indexed
Ensure-Field $L "ClientRef" "Text" -Indexed

$F = "${Prefix}Firearms"
Ensure-List $F "GenericList" "Firearms recorded on each licence"
Set-TitleName $F "Serial no"
foreach ($c in "LicenceNo","FirearmType","Make","Model","Calibre","Purpose","Removed") { Ensure-Field $F $c "Text" }
Ensure-Field $F "LicenceRef" "Text" -Indexed
Ensure-Field $F "ClientRef" "Text" -Indexed

$S = "${Prefix}Staff"
Ensure-List $S "GenericList" "Who can use ZD Licensing, and their role (Admin, Officer, Viewer)"
Set-TitleName $S "Name"
foreach ($c in "Email","HubRole","StaffStatus") { Ensure-Field $S $c "Text" }
Ensure-Field $S "ClientRef" "Text" -Indexed

# Class, Purpose and Type codes - kept by Admins on the app's Codes page
$CodesList = "${Prefix}Codes"
Ensure-List $CodesList "GenericList" "Class, Purpose and firearm Type codes offered on the licence form (ZD Licensing app)"
Set-TitleName $CodesList "Code"
foreach ($c in "Description","Active") { Ensure-Field $CodesList $c "Text" }
Ensure-Field $CodesList "SortOrder" "Number"
Ensure-Field $CodesList "CodeSet" "Text" -Indexed
Ensure-Field $CodesList "ClientRef" "Text" -Indexed

$A = "${Prefix}Activity"
Ensure-List $A "GenericList" "Activity log - sign-ins, licence changes, photos, cards printed"
Set-TitleName $A "Action"
foreach ($c in "LicenceNo","ActivityBy","ActivityAt") { Ensure-Field $A $c "Text" }
Ensure-Field $A "Details" "Note"
Ensure-Field $A "LicenceRef" "Text" -Indexed
Ensure-Field $A "HolderRef" "Text" -Indexed
Ensure-Field $A "ClientRef" "Text" -Indexed

# ---------------------------------------------------------------------
Pause-Step "STEP 3 of 4 - Create the libraries ${Prefix}LicencePhotos, ${Prefix}CardBackgrounds and ${Prefix}Documents"
Ensure-List "${Prefix}LicencePhotos" "DocumentLibrary" "Licence holders' photos (one folder per licence)"
$B = "${Prefix}CardBackgrounds"
Ensure-List $B "DocumentLibrary" "ID card background pictures. Best size 1012 x 638 px (or 638 x 1012 upright)"
foreach ($c in "Orientation","TextColour","ShowHeader","Active","TextPanel","Layout","Preprinted") { Ensure-Field $B $c "Text" }

# Documents attached to a licence holder or to one of their licences (a folder per holder)
$DocLib = "${Prefix}Documents"
Ensure-List $DocLib "DocumentLibrary" "Documents attached to licence holders and their licences (ZD Licensing app)"
foreach ($c in "DocType","DocDate","HolderName","LicenceNo","OriginalName","UploadedBy","UploadedAt") { Ensure-Field $DocLib $c "Text" }
Ensure-Field $DocLib "DocDescription" "Note"
Ensure-Field $DocLib "HolderRef" "Text" -Indexed
Ensure-Field $DocLib "LicenceRef" "Text" -Indexed
Ensure-Field $DocLib "ClientRef" "Text" -Indexed

# ---------------------------------------------------------------------
Pause-Step "STEP 4 of 4 - Create the SharePoint group '$OfficeGroup' (Edit rights) and add you"
$g = $null; try { $g = Get-PnPGroup -Identity $OfficeGroup -ErrorAction Stop } catch { $g = $null }
if ($g) { Skip "Group $OfficeGroup" }
else {
    New-PnPGroup -Title $OfficeGroup -Description "People who use the ZD Licensing app" | Out-Null
    Set-PnPGroupPermissions -Identity $OfficeGroup -AddRole "Edit" | Out-Null
    Ok "Group $OfficeGroup (Edit)"
}
Add-PnPGroupMember -Group $OfficeGroup -LoginName $Owner | Out-Null
Ok "Added $Owner to $OfficeGroup"

Write-Host ""
Write-Host "All done. Put these into shared/zd-config.js (by pull request):" -ForegroundColor Cyan
Write-Host "  TENANT_ID: `"$TenantId`""
Write-Host "  SP_HOST:   `"$TenantName.sharepoint.com`""
Write-Host "  SITE_PATH: `"$SitePath`""
Write-Host ""
Write-Host "Add the other users to the group in the browser: site Settings (gear) > Site permissions >" -ForegroundColor Cyan
Write-Host "Advanced permissions settings > '$OfficeGroup' > New > Add users." -ForegroundColor Cyan
