; Daylens uninstall: offer to delete the user's data (history, reports, downloaded models) — default No.
; Skipped when the uninstaller runs as part of an upgrade (${isUpdated}), so updating never touches data.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 /SD IDNO "Also delete your Daylens history, reports and downloaded AI models?$\r$\n$\r$\nChoose No to keep them for a future install." IDNO daylens_keep
      RMDir /r "$APPDATA\Daylens"
    daylens_keep:
  ${endIf}
!macroend
