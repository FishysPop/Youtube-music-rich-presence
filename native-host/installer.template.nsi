!define APPNAME "%%APPNAME%%"
!define COMPANYNAME "%%COMPANYNAME%%"
!define NATIVE_HOST_NAME "%%NATIVE_HOST_NAME%%"
!define NATIVE_HOST_MANIFEST_FILENAME "%%NATIVE_HOST_MANIFEST_FILENAME%%"
!define NATIVE_HOST_EXE_FILENAME "%%NATIVE_HOST_EXE_FILENAME%%"
!define EXTENSION_ID "%%EXTENSION_ID%%"
!define OUTPUT_FILENAME "%%OUTPUT_FILENAME%%"

!include "StrFunc.nsh"
${Using:StrFunc} StrRep

OutFile "%%OUTFILE_PATH%%"
InstallDir "%%INSTALL_DIR_NSIS%%"
RequestExecutionLevel user

Page directory
Page instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File "%%PACKAGED_HOST_PATH%%"

  ; Construct the full path for the manifest's "path" field
  StrCpy $1 "$INSTDIR\${NATIVE_HOST_EXE_FILENAME}"

  ; Escape single backslashes to double backslashes for JSON compatibility
  ; This ensures C:\Path\To\File.exe becomes C:\\Path\\To\\File.exe in $1
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

  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\${NATIVE_HOST_NAME}" "" "$INSTDIR\${NATIVE_HOST_MANIFEST_FILENAME}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\${NATIVE_HOST_MANIFEST_FILENAME}"
  Delete "$INSTDIR\${NATIVE_HOST_EXE_FILENAME}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\${NATIVE_HOST_NAME}"
SectionEnd
