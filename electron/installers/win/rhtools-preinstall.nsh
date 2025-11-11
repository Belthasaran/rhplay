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

!insertmacro TrimNewLines

Var RHToolsPlanJson
Var RHToolsPlanSummary
Var RHToolsNeedProvision
Var RHToolsSummaryContent
Var RHToolsDialog
Var RHToolsTextbox
Var RHToolsRefreshBtn
Var RHToolsOpenBtn
Var RHToolsCliCommand
Var RHToolsProgressLog
Var RHToolsProgressDone

Function RHTools_InitVariables
  SetOutPath $INSTDIR
  LogSet on
  StrCpy $RHToolsPlanJson "$TEMP\rhtools-plan.json"
  StrCpy $RHToolsPlanSummary "$TEMP\rhtools-plan.txt"
  StrCpy $RHToolsNeedProvision "no"
  StrCpy $RHToolsSummaryContent ""
FunctionEnd

Function RHTools_RunPlan
  IfFileExists "$INSTDIR\${RHTOOLS_APP_EXE}" 0 noExecutable
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\electron\installer\prepare_databases.js" 0 noScript
  Call RHTools_DetermineArgs
  StrCpy $0 '$RHToolsCliCommand --manifest "$INSTDIR\resources\db\dbmanifest.json" --ensure-dirs --write-plan="$RHToolsPlanJson" --write-summary="$RHToolsPlanSummary"'
  Delete $RHToolsPlanJson
  Delete $RHToolsPlanSummary
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"1")'
  nsExec::ExecToStack $0
  Pop $1 ; return code
  Pop $2 ; output (ignored)
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"")'
  ${If} $1 != 0
    ${If} $2 != ""
      MessageBox MB_ICONSTOP "Failed to generate database preparation plan.$\r$\n$2" /SD IDOK
    ${Else}
      MessageBox MB_ICONSTOP "Failed to generate database preparation plan (exit code $1)." /SD IDOK
    ${EndIf}
    Abort
  ${EndIf}
  Call RHTools_ReadSummary
  Return

noExecutable:
  StrCpy $RHToolsSummaryContent "Installer files are still being copied. When installation completes, click Refresh and then Continue to provision databases."
  StrCpy $RHToolsNeedProvision "yes"
  Return

noScript:
  StrCpy $RHToolsSummaryContent "Provisioning script is not yet available. When installation completes, click Refresh and then Continue to provision databases."
  StrCpy $RHToolsNeedProvision "yes"
  Return
FunctionEnd

Function RHTools_RunProvision
  IfFileExists "$INSTDIR\${RHTOOLS_APP_EXE}" 0 noExecutable
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\electron\installer\prepare_databases.js" 0 noScript
  Call RHTools_DetermineArgs
  StrCpy $RHToolsProgressLog "$TEMP\rhtools-progress.log"
  StrCpy $RHToolsProgressDone "$TEMP\rhtools-progress.done"
  Delete $RHToolsProgressLog
  Delete $RHToolsProgressDone
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"1")'
  StrCpy $0 '"$SYSDIR\cmd.exe" /C start "" /B $RHToolsCliCommand --manifest "$INSTDIR\resources\db\dbmanifest.json" --ensure-dirs --provision --write-plan="$RHToolsPlanJson" --write-summary="$RHToolsPlanSummary" --progress-log "$RHToolsProgressLog" --progress-done "$RHToolsProgressDone"'
  nsExec::Exec $0
  Pop $1
  System::Call 'Kernel32::SetEnvironmentVariableW(w"ELECTRON_RUN_AS_NODE", w"")'
  ${If} $1 != 0
    MessageBox MB_ICONSTOP "Failed to launch provisioning helper (exit code $1)." /SD IDOK
    Abort
  ${EndIf}

loopProgress:
  Call RHTools_UpdateProgress
  IfFileExists "$RHToolsProgressDone" 0 +3
    Sleep 500
    Goto loopProgress

  Call RHTools_UpdateProgress
  Call RHTools_RunPlan
  Return

noExecutable:
  MessageBox MB_ICONSTOP "Executable not found yet. Please wait for installation to finish copying files before running provisioning." /SD IDOK
  Abort

noScript:
  MessageBox MB_ICONSTOP "Provisioning script not available yet. Please wait for installation to finish copying files before running provisioning." /SD IDOK
  Abort
FunctionEnd

Function RHTools_UpdateProgress
  Push $0
  Push $1
  StrCpy $1 ""
  IfFileExists "$RHToolsProgressLog" 0 done
    FileOpen $0 "$RHToolsProgressLog" r
    ${If} $0 == ""
      Goto done
    ${EndIf}
    ${Do}
      FileRead $0 $2
      ${If} ${Errors}
        ${Break}
      ${EndIf}
      ${TrimNewLines} $2 $2
      StrCpy $1 "$1$2$\r$\n"
    ${Loop}
    FileClose $0
  done:
  ${If} $RHToolsTextbox != 0
    ${NSD_SetText} $RHToolsTextbox $1
    SendMessage $RHToolsTextbox ${EM_SETSEL} -1 -1
  ${EndIf}
  Pop $1
  Pop $0
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

Function RHTools_DetermineArgs
  StrCpy $RHToolsCliCommand '"$INSTDIR\${RHTOOLS_APP_EXE}" "$INSTDIR\resources\app.asar.unpacked\electron\installer\prepare_databases.js"'
FunctionEnd

Function RHToolsPlanPageCreate
  Call RHTools_InitVariables
  Call RHTools_RunPlan

  nsDialogs::Create 1018
  Pop $RHToolsDialog
  ${If} $RHToolsDialog == "error"
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "RHTools database provisioning"
  ${NSD_CreateText} 0 14u 100% 110u ""
  Pop $RHToolsTextbox
  SendMessage $RHToolsTextbox ${EM_SETREADONLY} 1 0
  ${NSD_SetText} $RHToolsTextbox $RHToolsSummaryContent

  ${NSD_CreateButton} 0 130u 90u 12u "Refresh"
  Pop $RHToolsRefreshBtn
  ${NSD_OnClick} $RHToolsRefreshBtn RHTools_OnRefresh

  ${NSD_CreateButton} 95u 130u 90u 12u "Open ArDrive"
  Pop $RHToolsOpenBtn
  ${NSD_OnClick} $RHToolsOpenBtn RHTools_OnOpenArDrive

  ${NSD_CreateLabel} 0 148u 100% 24u "After reviewing this summary, click Next to continue. If provisioning is still required, you will be prompted to run it automatically. To manually download files instead, open the ArDrive link above before proceeding."

  nsDialogs::Show
FunctionEnd

Function RHTools_OnRefresh
  Call RHTools_RunPlan
  ${If} $RHToolsTextbox != 0
    ${NSD_SetText} $RHToolsTextbox $RHToolsSummaryContent
  ${EndIf}
FunctionEnd

Function RHTools_OnOpenArDrive
  ExecShell "open" ${RHTOOLS_ARD_URL}
FunctionEnd

Function RHToolsPlanPageLeave
  Call RHTools_RunPlan
  ${If} $RHToolsNeedProvision == "yes"
    MessageBox MB_ICONQUESTION|MB_YESNO "Provisioning is required. Run automatic provisioning now?" IDYES +2
    MessageBox MB_ICONEXCLAMATION "Provisioning is still pending. You can download the required files manually from ArDrive and click Refresh." /SD IDOK
    Abort

    Call RHTools_RunProvision
    ${If} $RHToolsNeedProvision == "yes"
      MessageBox MB_ICONEXCLAMATION "Provisioning is still pending. Please resolve the issues shown in the summary before continuing." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
Page Custom RHToolsPlanPageCreate RHToolsPlanPageLeave
!insertmacro MUI_PAGE_FINISH

; !insertmacro MUI_LANGUAGE "English"

