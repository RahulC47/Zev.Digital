; installer-hooks.nsh
; Custom NSIS hooks for Zev.Digital installer.
; This hook runs BEFORE files are copied, killing any running instance
; of the app or its Python sidecar so the installer can overwrite them.

!macro NSIS_HOOK_PREINSTALL
  ; Kill the main Zev.Digital process if running
  nsExec::Exec 'taskkill /F /IM "Zev.Digital.exe"'
  ; Kill the Python sidecar process if running
  nsExec::Exec 'taskkill /F /IM "contxt-sidecar.exe"'
  ; Brief pause to let OS release file handles
  Sleep 2000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Nothing needed after install
!macroend
