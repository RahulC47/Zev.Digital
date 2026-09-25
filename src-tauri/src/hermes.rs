use serde::{Deserialize, Serialize};
use tauri::State;
use crate::commands::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct AutomationStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct StepResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Execute a single automation step from the Hermes Desktop panel.
#[tauri::command]
pub async fn run_automation_step(
    _state: State<'_, AppState>,
    step: AutomationStep,
) -> Result<StepResult, String> {
    match step.step_type.as_str() {
        "run_command" => run_powershell(&step.value).await,
        "open_url" => open_url_step(&step.value),
        "wait_ms" => {
            let ms = step.value.parse::<u64>().unwrap_or(500);
            tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
            Ok(StepResult { success: true, output: format!("Waited {ms}ms"), error: None })
        }
        "type_text" => {
            // Future: integrate with a keystroke library.
            // Text is written to the run output; user can copy-paste.
            Ok(StepResult {
                success: true,
                output: format!("Text ready: {}", step.value),
                error: None,
            })
        }
        _ => Err(format!("Unknown step type: {}", step.step_type)),
    }
}

async fn run_powershell(command: &str) -> Result<StepResult, String> {
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NonInteractive", "-NoProfile", "-Command", command]);

    // Suppress the console window on Windows.
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await.map_err(|e: std::io::Error| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(StepResult { success: true, output: stdout, error: None })
    } else {
        Ok(StepResult {
            success: false,
            output: stdout,
            error: Some(if stderr.is_empty() {
                format!("Exit code: {}", output.status)
            } else {
                stderr
            }),
        })
    }
}

fn open_url_step(url: &str) -> Result<StepResult, String> {
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(StepResult { success: true, output: format!("Opened: {url}"), error: None })
}
