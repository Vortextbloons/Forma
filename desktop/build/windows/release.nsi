Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Name "Forma"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Forma"
InstallDirRegKey HKCU "Software\Forma" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Forma"
VIAddVersionKey "FileDescription" "Forma Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
!define MUI_ICON "icon.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section
    SetShellVarContext current
    SetRegView 64
    ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $0 == ""
    ${AndIf} $1 == ""
        InitPluginsDir
        SetOutPath "$PLUGINSDIR"
        File "${PAYLOAD}\..\MicrosoftEdgeWebview2Setup.exe"
        ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
        ${If} $0 != 0
            SetErrorLevel 1
            Abort "Could not install WebView2. Check your connection and try again."
        ${EndIf}
    ${EndIf}
    SetOutPath "$INSTDIR"
    ClearErrors
    File /r "\\?\${PAYLOAD}\*"
    IfErrors 0 +3
        SetErrorLevel 1
        Abort "Could not install Forma. Close Forma and try again."
    WriteRegStr HKCU "Software\Forma" "InstallDir" "$INSTDIR"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    CreateShortcut "$SMPROGRAMS\Forma.lnk" "$INSTDIR\Forma.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma" "DisplayName" "Forma"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma" "NoRepair" 1
SectionEnd

Section "Uninstall"
    SetShellVarContext current
    Delete "$SMPROGRAMS\Forma.lnk"
    Delete "$INSTDIR\Forma.exe"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir /r "$INSTDIR\runtime"
    RMDir "$INSTDIR"
    DeleteRegKey HKCU "Software\Forma"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Forma"
SectionEnd
