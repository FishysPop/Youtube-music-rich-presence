!define APPNAME "%%APPNAME%%"
!define COMPANYNAME "%%COMPANYNAME%%"
!define NATIVE_HOST_NAME "%%NATIVE_HOST_NAME%%"
!define NATIVE_HOST_MANIFEST_FILENAME "%%NATIVE_HOST_MANIFEST_FILENAME%%"
!define NATIVE_HOST_EXE_FILENAME "%%NATIVE_HOST_EXE_FILENAME%%"
!define EXTENSION_ID "%%EXTENSION_ID%%"
!define OUTPUT_FILENAME "%%OUTPUT_FILENAME%%"

!include "StrFunc.nsh"
!include "LogicLib.nsh"
${Using:StrFunc} StrRep

OutFile "%%OUTFILE_PATH%%"
InstallDir "%%INSTALL_DIR_NSIS%%"
RequestExecutionLevel user

Page directory
Page instfiles

Function .onInit
  ; Check for existing installation
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString"
  StrCmp $R0 "" no_uninstall

  ; --- Existing Installation Found ---

  ; Check if Chrome is running and prompt user to close it
  FindWindow $R1 "Chrome_WidgetWin_1"
  ${If} $R1 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "${APPNAME} is already installed, and it appears Chrome is running. Please close all Chrome windows to ensure a smooth update. Click OK to continue after closing Chrome, or Cancel to abort." \
    /SD IDOK IDOK chrome_closed_continue
    Abort ; User canceled
    chrome_closed_continue:
      ; User clicked OK, proceed without re-checking
  ${EndIf}

  ; Prompt for uninstallation of the old version
  MessageBox MB_OKCANCEL|MB_ICONQUESTION \
  'An older version of ${APPNAME} is installed. Do you want to uninstall it before installing the new version?' \
  /SD IDOK IDOK uninstall_old_version
  Abort

uninstall_old_version:
  ; Terminate the running process before uninstalling
  Exec 'taskkill /F /IM "${NATIVE_HOST_EXE_FILENAME}"'
  Sleep 1000 ; Give it a moment to close
  
  ; Silently run the uninstaller
  ExecWait '"$R0" /S _?=$INSTDIR'

no_uninstall:
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  File "%%PACKAGED_HOST_PATH%%"

  ; Construct the full path for the manifest's "path" field
  StrCpy $1 "$INSTDIR\${NATIVE_HOST_EXE_FILENAME}"

  ; Escape single backslashes to double backslashes for JSON compatibility
  ${StrRep} $1 $1 "\" "\\"

  FileOpen $2 "$INSTDIR\${NATIVE_HOST_MANIFEST_FILENAME}" w

  ; Write JSON content line by line
  StrCpy $3 '{$\r$\n' ; Opening brace and newline
  FileWrite $2 $3

  StrCpy $3 '  "name": "${NATIVE_HOST_NAME}",$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '  "description": "YouTube Music Rich Presence Host",$\r$\n'
  FileWrite $2 $3

  ; Use the correctly escaped path from $1
  StrCpy $3 '  "path": "$1",$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '  "type": "stdio",$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '  "allowed_origins": [$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '    "chrome-extension://${EXTENSION_ID}/"$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '  ]$\r$\n'
  FileWrite $2 $3

  StrCpy $3 '}$\r$\n' ; Closing brace and newline
  FileWrite $2 $3

  FileClose $2

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${NATIVE_HOST_NAME}" "" "$INSTDIR\${NATIVE_HOST_MANIFEST_FILENAME}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Terminate the running process before uninstalling
  Exec 'taskkill /F /IM "${NATIVE_HOST_EXE_FILENAME}"'
  Sleep 1000 ; Give it a moment to close

  Delete "$INSTDIR\${NATIVE_HOST_MANIFEST_FILENAME}"
  Delete "$INSTDIR\${NATIVE_HOST_EXE_FILENAME}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${NATIVE_HOST_NAME}"
SectionEnd
