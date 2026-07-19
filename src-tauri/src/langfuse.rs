//! Opt-in Langfuse Cloud trace export. Nothing is sent unless the user
//! explicitly enables it in Settings and provides API keys.

use crate::vault::LlmTrace;
use anyhow::Result;
use serde_json::json;

pub async fn export_trace(
    host: &str,
    public_key: &str,
    secret_key: &str,
    trace: &LlmTrace,
) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let body = json!({
        "batch": [{
            "id": trace.id,
            "type": "trace-create",
            "timestamp": trace.timestamp,
            "body": {
                "id": trace.id,
                "name": format!("zev-{}", trace.kind),
                "input": {
                    "system": trace.system_prompt,
                    "user": trace.user_prompt,
                },
                "output": {
                    "text": trace.response,
                },
                "metadata": {
                    "provider": trace.provider,
                    "model": trace.model,
                    "input_tokens": trace.input_tokens,
                    "output_tokens": trace.output_tokens,
                    "latency_ms": trace.latency_ms,
                    "source": "zev-desktop",
                },
            },
        }]
    });

    let url = format!("{}/api/public/ingestion", host.trim_end_matches('/'));
    client
        .post(&url)
        .basic_auth(public_key, Some(secret_key))
        .json(&body)
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}
