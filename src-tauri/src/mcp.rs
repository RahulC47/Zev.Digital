//! MCP (Model Context Protocol) client.
//! Calls stdio-based or HTTP MCP servers so the LLM can use external tools.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::commands::AppState;
use crate::settings::McpServer;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub server_id: String,
    /// JSON schema as a string
    pub input_schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub tool: String,
    pub server_id: String,
    pub output: String,
    pub error: Option<String>,
}

/// List all tools exposed by all configured MCP servers.
/// For HTTP servers: GET {url}/tools
/// For stdio servers: spawn process, send {"method":"tools/list"} JSON-RPC, read response
#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<McpTool>, String> {
    let servers = {
        let s = state.settings.lock().unwrap();
        s.mcp_servers.clone()
    };

    let mut all_tools = Vec::new();
    for server in &servers {
        if !server.enabled { continue; }
        match list_tools_from_server(server).await {
            Ok(tools) => all_tools.extend(tools),
            Err(e) => log::warn!("MCP server '{}' list_tools error: {e}", server.id),
        }
    }
    Ok(all_tools)
}

async fn list_tools_from_server(server: &McpServer) -> Result<Vec<McpTool>, String> {
    if server.transport == "http" {
        list_tools_http(server).await
    } else {
        list_tools_stdio(server).await
    }
}

async fn list_tools_http(server: &McpServer) -> Result<Vec<McpTool>, String> {
    let url = format!("{}/tools", server.url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build().map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // MCP HTTP returns {"tools": [{"name":..., "description":..., "inputSchema":...}]}
    let tools = json["tools"].as_array().cloned().unwrap_or_default();
    Ok(tools.into_iter().map(|t| McpTool {
        name: t["name"].as_str().unwrap_or("").to_string(),
        description: t["description"].as_str().unwrap_or("").to_string(),
        server_id: server.id.clone(),
        input_schema: t.get("inputSchema").map(|s| s.to_string()),
    }).collect())
}

async fn list_tools_stdio(server: &McpServer) -> Result<Vec<McpTool>, String> {
    let parts: Vec<&str> = server.url.split_whitespace().collect();
    if parts.is_empty() { return Err("Empty command".into()); }
    let (cmd, args) = (parts[0], &parts[1..]);

    let mut child_cmd = tokio::process::Command::new(cmd);
    child_cmd.args(args);
    
    #[cfg(target_os = "windows")]
    {
        child_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    
    let mut child = child_cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server '{}': {e}", server.id))?;

    use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};

    // Send initialize + tools/list
    let init = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"zev","version":"1"}}});
    let list = serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}});

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(format!("{init}\n{list}\n").as_bytes()).await;
        let _ = stdin.flush().await;
    }

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    let mut tools = Vec::new();

    // Read up to 20 lines within 5 seconds for the tools/list response
    let timeout = tokio::time::Duration::from_secs(5);
    let mut count = 0;
    while let Ok(Ok(Some(line))) = tokio::time::timeout(timeout, lines.next_line()).await {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            if json["id"] == 2 {
                if let Some(arr) = json["result"]["tools"].as_array() {
                    for t in arr {
                        tools.push(McpTool {
                            name: t["name"].as_str().unwrap_or("").to_string(),
                            description: t["description"].as_str().unwrap_or("").to_string(),
                            server_id: server.id.clone(),
                            input_schema: t.get("inputSchema").map(|s| s.to_string()),
                        });
                    }
                    break;
                }
            }
        }
        count += 1;
        if count > 20 { break; }
    }
    let _ = child.kill().await;
    Ok(tools)
}

/// Call a specific MCP tool on the appropriate server.
#[tauri::command]
pub async fn call_mcp_tool(
    state: State<'_, AppState>,
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, String> {
    let server = {
        let s = state.settings.lock().unwrap();
        s.mcp_servers.iter().find(|sv| sv.id == server_id).cloned()
    }.ok_or_else(|| format!("MCP server '{}' not found", server_id))?;

    let output = if server.transport == "http" {
        call_tool_http(&server, &tool_name, &arguments).await
    } else {
        call_tool_stdio(&server, &tool_name, &arguments).await
    };

    match output {
        Ok(text) => Ok(McpToolResult { tool: tool_name, server_id, output: text, error: None }),
        Err(e) => Ok(McpToolResult { tool: tool_name, server_id, output: String::new(), error: Some(e) }),
    }
}

async fn call_tool_http(server: &McpServer, tool: &str, args: &serde_json::Value) -> Result<String, String> {
    let url = format!("{}/tools/call", server.url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e| e.to_string())?;
    let body = serde_json::json!({"name": tool, "arguments": args});
    let resp = client.post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // MCP response: {"content": [{"type":"text","text":"..."}]}
    let text = json["content"].as_array()
        .and_then(|arr| arr.first())
        .and_then(|c| c["text"].as_str())
        .unwrap_or("")
        .to_string();
    Ok(text)
}

async fn call_tool_stdio(server: &McpServer, tool: &str, args: &serde_json::Value) -> Result<String, String> {
    let parts: Vec<&str> = server.url.split_whitespace().collect();
    if parts.is_empty() { return Err("Empty command".into()); }
    let (cmd, cmd_args) = (parts[0], &parts[1..]);

    let mut child_cmd = tokio::process::Command::new(cmd);
    child_cmd.args(cmd_args);
    
    #[cfg(target_os = "windows")]
    {
        child_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = child_cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};

    let init = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"zev","version":"1"}}});
    let call = serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name": tool, "arguments": args}});

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(format!("{init}\n{call}\n").as_bytes()).await;
        let _ = stdin.flush().await;
    }

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    let timeout = tokio::time::Duration::from_secs(30);
    let mut count = 0;
    while let Ok(Ok(Some(line))) = tokio::time::timeout(timeout, lines.next_line()).await {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            if json["id"] == 2 {
                let text = json["result"]["content"].as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|c| c["text"].as_str())
                    .unwrap_or_default()
                    .to_string();
                let _ = child.kill().await;
                return Ok(text);
            }
        }
        count += 1;
        if count > 50 { break; }
    }
    let _ = child.kill().await;
    Err("No response from MCP server".into())
}
