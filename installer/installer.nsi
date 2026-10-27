; AFIF ImgShrink 1.2.0 installer — includes AS USB
;
; Build:
;   makensis /DSRCDIR="C:\path\to\payload" installer.nsi
;
; SRCDIR must contain the Electron app payload:
;   AFIF ImgShrink.exe, *.dll, *.pak, icudtl.dat, locales\, resources\
; with resources\app\ (unpacked app source) and resources\bin\AS-USB.exe.
Unicode true
!include "MUI2.nsh"
!include "x64.nsh"

!define APPNAME     "AFIF ImgShrink"
!define APPVERSION  "1.2.0"
!define PUBLISHER   "AFIF-TECH"
!define APPEXE      "AFIF ImgShrink.exe"

!ifndef SRCDIR
  !define SRCDIR "${__FILEDIR__}\..\app"
!endif
!ifndef ICONFILE
  !define ICONFILE "${__FILEDIR__}\app.ico"
!endif
!ifndef OUTFILE
  !define OUTFILE "AFIF-ImgShrink-Setup-${APPVERSION}.exe"
!endif

!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AFIFImgShrink"

Name "${APPNAME}"
OutFile "${OUTFILE}"

VIProductVersion "1.2.0.0"
VIAddVersionKey "ProductName"      "${APPNAME}"
VIAddVersionKey "CompanyName"      "${PUBLISHER}"
VIAddVersionKey "FileDescription"  "AFIF ImgShrink 1.2.0 Setup with AS USB"
VIAddVersionKey "FileVersion"      "1.2.0.0"
VIAddVersionKey "ProductVersion"   "1.2.0"
VIAddVersionKey "LegalCopyright"   "AFIF-TECH - Afif Khoury. Includes GPLv3 components."

InstallDir "$PROGRAMFILES64\AFIF ImgShrink"
InstallDirRegKey HKLM "Software\AFIF-TECH\ImgShrink" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 32

Icon "${ICONFILE}"
UninstallIcon "${ICONFILE}"

!define MUI_ABORTWARNING
!define MUI_ICON "${ICONFILE}"
!define MUI_UNICON "${ICONFILE}"
!define MUI_WELCOMEPAGE_TITLE "AFIF ImgShrink ${APPVERSION}"
!define MUI_WELCOMEPAGE_TEXT "This will install AFIF ImgShrink: shrink Raspberry Pi and Linux images, read and write SD cards, and create bootable USB drives with AS USB.$\r$\n$\r$\nClick Next to continue."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "AFIF ImgShrink" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\AFIF-TECH"
  CreateShortCut "$SMPROGRAMS\AFIF-TECH\AFIF ImgShrink.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateShortCut "$SMPROGRAMS\AFIF-TECH\Uninstall AFIF ImgShrink.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\AFIF ImgShrink.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0

  WriteRegStr HKLM "Software\AFIF-TECH\ImgShrink" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REGKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr HKLM "${REGKEY}" "DisplayVersion"  "${APPVERSION}"
  WriteRegStr HKLM "${REGKEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr HKLM "${REGKEY}" "DisplayIcon"     "$INSTDIR\${APPEXE}"
  WriteRegStr HKLM "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\AFIF ImgShrink.lnk"
  RMDir /r "$SMPROGRAMS\AFIF-TECH"
  DeleteRegKey HKLM "${REGKEY}"
  DeleteRegKey HKLM "Software\AFIF-TECH\ImgShrink"
  RMDir /r "$INSTDIR"
SectionEnd
