; installer-hooks.nsh
; Custom NSIS hooks for Zev.Digital installer.
; Runs BEFORE files are copied — forcefully terminates any running
; instance of Zev.Digital or its Python sidecar so the installer
; can overwrite locked files without error.

!macro NSIS_HOOK_PREINSTALL
  ; --- Gracefully close the main window first ---
  FindWindow $0 "" "Zev.Digital"
  ${If} $0 != 0
    SendMessage $0 ${WM_CLOSE} 0 0
    Sleep 1500
  ${EndIf}

  ; --- Force-kill main process (ExecWait = blocking, waits for taskkill to finish) ---
  ExecWait 'taskkill /F /IM "Zev.Digital.exe"'

  ; --- Force-kill the Python sidecar ---
  ExecWait 'taskkill /F /IM "contxt-sidecar.exe"'

  ; --- Wait for the OS to fully release file handles ---
  Sleep 3000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Nothing needed after install
!macroend
