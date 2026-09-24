use std::process::Command;
use std::path::PathBuf;
use std::os::windows::process::CommandExt;

/// Checks if Ollama is installed by attempting to run `ollama --version`.
#[tauri::command]
pub fn check_ollama() -> bool {
    // 0x08000000 is CREATE_NO_WINDOW flag on Windows to prevent console popup
    match Command::new("ollama")
        .arg("--version")
        .creation_flags(0x08000000)
        .output()
    {
        Ok(output) => output.status.success(),
        Err(_) => {
            // Fallback: check default installation path just in case it's not in PATH
            let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "".to_string());
            if !local_app_data.is_empty() {
                let path = PathBuf::from(local_app_data).join("Programs").join("Ollama").join("ollama.exe");
                path.exists()
            } else {
                false
            }
        }
    }
}

/// Downloads and installs Ollama on Windows.
#[tauri::command]
pub async fn install_ollama() -> Result<(), String> {
    if check_ollama() {
        return Ok(()); // Already installed
    }

    let url = "https://ollama.com/download/OllamaSetup.exe";
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("OllamaSetup.exe");

    // Download the installer
    let response = reqwest::get(url).await.map_err(|e| format!("Download failed: {}", e))?;
    let bytes = response.bytes().await.map_err(|e| format!("Failed to read bytes: {}", e))?;
    
    std::fs::write(&installer_path, bytes).map_err(|e| format!("Failed to write installer: {}", e))?;

    // Run the installer
    // Note: OllamaSetup.exe doesn't have a fully silent mode that skips the UI entirely,
    // but running it will prompt the user to click install.
    let status = Command::new(&installer_path)
        .status()
        .map_err(|e| format!("Failed to launch installer: {}", e))?;

    if status.success() {
        // Try to start it in the background if it didn't start automatically
        let _ = Command::new("ollama")
            .arg("serve")
            .creation_flags(0x08000000)
            .spawn();
        Ok(())
    } else {
        Err("Installer did not finish successfully.".to_string())
    }
}
