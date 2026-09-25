use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use crate::commands::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub temperature: f64,
    pub model_override: Option<String>,
    pub system_prompt: String,
}

impl Default for Skill {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            icon: "🤖".to_string(),
            temperature: 0.3,
            model_override: None,
            system_prompt: String::new(),
        }
    }
}

/// Simple parser for Markdown with YAML frontmatter
fn parse_skill_md(file_name: &str, content: &str) -> Skill {
    let mut skill = Skill::default();
    skill.id = file_name.replace(".md", "");
    skill.name = skill.id.clone();

    if content.starts_with("---\n") || content.starts_with("---\r\n") {
        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() == 3 {
            let frontmatter = parts[1];
            skill.system_prompt = parts[2].trim().to_string();

            for line in frontmatter.lines() {
                let line = line.trim();
                if let Some((key, val)) = line.split_once(':') {
                    let k = key.trim();
                    let v = val.trim().trim_matches('"').trim_matches('\'');
                    match k {
                        "name" => skill.name = v.to_string(),
                        "icon" => skill.icon = v.to_string(),
                        "temperature" => {
                            if let Ok(t) = v.parse::<f64>() {
                                skill.temperature = t;
                            }
                        }
                        "model" => skill.model_override = Some(v.to_string()),
                        _ => {}
                    }
                }
            }
            return skill;
        }
    }
    
    // No frontmatter fallback
    skill.system_prompt = content.trim().to_string();
    skill
}

pub fn get_skills_dir(app_data_dir: &Path) -> PathBuf {
    let dir = app_data_dir.join("skills");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
        // Seed default skills
        let default_skills = vec![
            ("legal_advisor.md", "---\nname: Legal Advisor\nicon: ⚖️\ntemperature: 0.2\n---\nYou are a Legal Advisor specialising in Indian business law. Cover MCA compliance, contract review, IP basics, partnership/LLP structuring, and MSME-relevant regulations. Cite specific sections of law when possible. Clearly state when a matter needs a practicing lawyer."),
            ("code_reviewer.md", "---\nname: Code Reviewer\nicon: 💻\ntemperature: 0.1\n---\nYou are an expert software engineer. Review the provided code or context for bugs, performance issues, and readability. Suggest concrete improvements."),
            ("writing_assistant.md", "---\nname: Writing Assistant\nicon: ✍️\ntemperature: 0.7\n---\nYou are an expert copywriter and editor. Improve the clarity, tone, and impact of the text. Keep it concise and professional.")
        ];
        for (filename, content) in default_skills {
            let _ = fs::write(dir.join(filename), content);
        }
    }
    dir
}

pub fn list_skills_internal(app_data_dir: &Path) -> Vec<Skill> {
    let dir = get_skills_dir(app_data_dir);
    let mut skills = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md") {
                if let Ok(content) = fs::read_to_string(&path) {
                    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                    skills.push(parse_skill_md(&file_name, &content));
                }
            }
        }
    }
    
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

pub fn get_skill_internal(app_data_dir: &Path, id: &str) -> Option<Skill> {
    let dir = get_skills_dir(app_data_dir);
    let path = dir.join(format!("{}.md", id));
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            return Some(parse_skill_md(&format!("{}.md", id), &content));
        }
    }
    None
}

pub fn save_skill_internal(app_data_dir: &Path, skill: &Skill) -> Result<Skill, String> {
    let dir = get_skills_dir(app_data_dir);
    let id = if skill.id.trim().is_empty() {
        skill.name.to_lowercase().replace(' ', "_").chars().filter(|c| c.is_alphanumeric() || *c == '_').collect()
    } else {
        skill.id.clone()
    };
    let path = dir.join(format!("{}.md", id));
    let mut frontmatter = format!("---\nname: {}\nicon: {}\ntemperature: {}\n", skill.name, skill.icon, skill.temperature);
    if let Some(ref m) = skill.model_override {
        if !m.trim().is_empty() {
            frontmatter.push_str(&format!("model: {}\n", m.trim()));
        }
    }
    frontmatter.push_str("---\n");
    let content = format!("{}{}\n", frontmatter, skill.system_prompt.trim());
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let mut saved = skill.clone();
    saved.id = id;
    Ok(saved)
}

pub fn delete_skill_internal(app_data_dir: &Path, id: &str) -> Result<(), String> {
    let dir = get_skills_dir(app_data_dir);
    let path = dir.join(format!("{}.md", id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_skills(state: State<AppState>) -> Result<Vec<Skill>, String> {
    Ok(list_skills_internal(&state.vault_dir))
}

#[tauri::command]
pub fn get_skill(state: State<AppState>, id: String) -> Result<Option<Skill>, String> {
    Ok(get_skill_internal(&state.vault_dir, &id))
}

#[tauri::command]
pub fn save_skill(state: State<AppState>, skill: Skill) -> Result<Skill, String> {
    save_skill_internal(&state.vault_dir, &skill)
}

#[tauri::command]
pub fn delete_skill(state: State<AppState>, id: String) -> Result<(), String> {
    delete_skill_internal(&state.vault_dir, &id)
}

#[tauri::command]
pub fn open_skills_folder(state: State<AppState>) -> Result<(), String> {
    let dir = get_skills_dir(&state.vault_dir);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
