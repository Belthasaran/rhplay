!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "TextFunc.nsh"
!include "WordFunc.nsh"

!define RHTOOLS_APP_EXE "RHTools.exe"
!define RHTOOLS_SCRIPT "electron/installer/prepare_databases.js"
!define RHTOOLS_MANIFEST "electron/db/dbmanifest.json"
!define RHTOOLS_ARD_URL "https://app.ardrive.io/#/drives/58677413-8a0c-4982-944d-4a1b40454039?name=SMWRH"

!macro customFinishPageBefore
  Page Custom RHToolsPlanPageCreate RHToolsPlanPageLeave
!macroend
!insertmacro customFinishPageBefore

!insertmacro TrimNewLines

Var RHToolsPlanJson
Var RHToolsPlanSummary
Var RHToolsNeedProvision
Var RHToolsSummaryContent
Var RHToolsDialog
Var RHToolsTextbox
Var RHToolsRescanBtn
Var RHToolsOpenBtn
Var RHToolsCliCommand

Function RHTools_InitVariables
  StrCpy $RHToolsPlanJson "$TEMP\rhtools-plan.json"
  StrCpy $RHToolsPlanSummary "$TEMP\rhtools-plan.txt"
  StrCpy $RHToolsNeedProvision "no"
  StrCpy $RHToolsSummaryContent ""
FunctionEnd

Function RHTools_RunPlan
  IfFileExists "$INSTDIR\${RHTOOLS_APP_EXE}" 0 noExecutable
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\electron\installer\prepare_databases.js" 0 noScript
  Call RHTools_DetermineArgs
  Delete $RHToolsPlanJson
  Delete $RHToolsPlanSummary
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"1")'
  nsExec::ExecToStack "$RHToolsCliCommand --ensure-dirs --write-plan=$RHToolsPlanJson --write-summary=$RHToolsPlanSummary"
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"")'
  Pop $0 ; return code
  Pop $1 ; output (ignored)
  ${If} $0 != 0
    ${If} $1 != ""
      MessageBox MB_ICONSTOP "Failed to generate database preparation plan.$\r$\n$1" /SD IDOK
    ${Else}
      MessageBox MB_ICONSTOP "Failed to generate database preparation plan (exit code $0)." /SD IDOK
    ${EndIf}
    Abort
  ${EndIf}
  Call RHTools_ReadSummary
  Return

noExecutable:
  StrCpy $RHToolsSummaryContent "Installer files are still being copied. Please continue the installation and revisit this page once setup finishes copying files."
  StrCpy $RHToolsNeedProvision "no"
  Return

noScript:
  StrCpy $RHToolsSummaryContent "Provisioning script is not yet available. Please continue the installation and revisit this page once setup finishes copying files."
  StrCpy $RHToolsNeedProvision "no"
  Return
FunctionEnd

Function RHTools_ReadSummary
  StrCpy $RHToolsSummaryContent ""
  StrCpy $RHToolsNeedProvision "no"
  FileOpen $0 $RHToolsPlanSummary r
  ${If} $0 == ""
    StrCpy $RHToolsSummaryContent "Summary unavailable."
    Return
  ${EndIf}
  ${Do}
    FileRead $0 $1
    ${If} ${Errors}
      ${Break}
    ${EndIf}
    ${TrimNewLines} $1 $1
    ${If} $1 == ""
      StrCpy $RHToolsSummaryContent "$RHToolsSummaryContent$\r$\n"
    ${Else}
      StrCpy $RHToolsSummaryContent "$RHToolsSummaryContent$1$\r$\n"
      ${If} $1 == "PROVISION_REQUIRED=yes"
        StrCpy $RHToolsNeedProvision "yes"
      ${EndIf}
    ${EndIf}
  ${Loop}
  FileClose $0
FunctionEnd

Function RHToolsPlanPageCreate
  Call RHTools_InitVariables
  Call RHTools_RunPlan

  nsDialogs::Create 1018
  Pop $RHToolsDialog
  ${If} $RHToolsDialog == "error"
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "RHTools database preparation summary"
  ${NSD_CreateText} 0 14u 100% 120u ""
  Pop $RHToolsTextbox
  SendMessage $RHToolsTextbox ${EM_SETREADONLY} 1 0
  ${NSD_SetText} $RHToolsTextbox $RHToolsSummaryContent

  ${NSD_CreateButton} 0 140u 90u 12u "Open ArDrive"
  Pop $RHToolsOpenBtn
  ${NSD_OnClick} $RHToolsOpenBtn RHTools_OnOpenArDrive

  ${NSD_CreateButton} 95u 140u 90u 12u "Re-scan"
  Pop $RHToolsRescanBtn
  ${NSD_OnClick} $RHToolsRescanBtn RHTools_OnRescan

  ${NSD_CreateLabel} 0 158u 100% 12u "Click Next to proceed. Manual downloads are optional if you prefer to supply files yourself."

  nsDialogs::Show
FunctionEnd

Function RHTools_OnOpenArDrive
  ExecShell "open" ${RHTools_ARD_URL}
FunctionEnd

Function RHTools_OnRescan
  Call RHTools_RunPlan
  ${If} $RHToolsTextbox != 0
    ${NSD_SetText} $RHToolsTextbox $RHToolsSummaryContent
  ${EndIf}
FunctionEnd

Function RHTools_DetermineArgs
  StrCpy $RHToolsCliCommand '"$INSTDIR\${RHTOOLS_APP_EXE}" "$INSTDIR\resources\app.asar.unpacked\electron\installer\prepare_databases.js" --manifest "$INSTDIR\resources\db\dbmanifest.json"'
FunctionEnd

Function RHToolsPlanPageLeave
  StrCmp $RHToolsNeedProvision "yes" needProvision done

done:
  Return

needProvision:
  MessageBox MB_YESNO "RHTools can download and assemble the required databases now. Proceed?" IDYES doProvision
  Abort

doProvision:
  Call RHTools_DetermineArgs
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"1")'
  nsExec::ExecToLog "$RHToolsCliCommand --ensure-dirs --provision --write-plan=$RHToolsPlanJson --write-summary=$RHToolsPlanSummary"
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"")'
  Pop $0
  ${If} $0 != 0
    ${If} $1 != ""
      MessageBox MB_ICONSTOP "Database preparation failed.$\r$\n$1" /SD IDOK
    ${Else}
      MessageBox MB_ICONSTOP "Database preparation failed (exit code $0)." /SD IDOK
    ${EndIf}
    Abort
  ${EndIf}
  Call RHTools_ReadSummary
  ${If} $RHToolsNeedProvision == "yes"
    MessageBox MB_ICONEXCLAMATION "Some database files are still missing or could not be prepared.$\r$\nPlease address the items listed and click Next again." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

