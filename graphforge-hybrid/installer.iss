; Inno Setup script for GraphForge desktop.
; Build the app first:  .venv\Scripts\pyinstaller graphforge.spec --noconfirm
; Then compile this with Inno Setup (ISCC.exe installer.iss) to produce GraphForge-Setup.exe.

#define MyAppName "GraphForge"
#define MyAppVersion "0.1.0"
#define MyAppExeName "GraphForge.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=GraphForge
DefaultDirName={autopf}\GraphForge
DefaultGroupName=GraphForge
DisableProgramGroupPage=yes
OutputDir=installer
OutputBaseFilename=GraphForge-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Install per-user so no admin rights are required.
PrivilegesRequired=lowest
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "dist\GraphForge\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\GraphForge"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall GraphForge"; Filename: "{uninstallexe}"
Name: "{userdesktop}\GraphForge"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch GraphForge"; Flags: nowait postinstall skipifsilent
