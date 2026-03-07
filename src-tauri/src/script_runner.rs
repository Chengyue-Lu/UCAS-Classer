use std::path::PathBuf;
use std::process::{Command, Output, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::paths::project_root;

const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug)]
pub struct ScriptOutput {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Copy, Clone, Debug)]
pub enum ScriptWindow {
    Hidden,
    Console,
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn base_command(script: &str, extra_args: &[&str]) -> Command {
    let mut command = Command::new(npm_command());
    command.current_dir(project_root());
    command.arg("run").arg(script);

    if !extra_args.is_empty() {
        command.arg("--");
        for arg in extra_args {
            command.arg(arg);
        }
    }

    command
}

fn apply_window_mode(command: &mut Command, mode: ScriptWindow) {
    #[cfg(windows)]
    {
        match mode {
            ScriptWindow::Hidden => {
                command.creation_flags(CREATE_NO_WINDOW);
            }
            ScriptWindow::Console => {
                command.creation_flags(CREATE_NEW_CONSOLE);
            }
        }
    }
}

fn decode_output(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).trim().to_string()
}

pub fn run_hidden_script(script: &str, extra_args: &[&str]) -> Result<ScriptOutput, String> {
    let mut command = base_command(script, extra_args);
    command.stdin(Stdio::null());
    apply_window_mode(&mut command, ScriptWindow::Hidden);

    let output = command
        .output()
        .map_err(|error| format!("failed to run `{script}`: {error}"))?;

    Ok(build_script_output(output))
}

pub fn run_visible_login_script(script: &str, extra_args: &[&str]) -> Result<ScriptOutput, String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd.exe");
        command.current_dir(project_root());
        command.arg("/C").arg(npm_command()).arg("run").arg(script);
        if !extra_args.is_empty() {
            command.arg("--");
            for arg in extra_args {
                command.arg(arg);
            }
        }
        command
    } else {
        base_command(script, extra_args)
    };

    command
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    apply_window_mode(&mut command, ScriptWindow::Console);

    let status = command
        .status()
        .map_err(|error| format!("failed to run visible `{script}`: {error}"))?;

    Ok(ScriptOutput {
        success: status.success(),
        exit_code: status.code().unwrap_or(-1),
        stdout: String::new(),
        stderr: String::new(),
    })
}

pub fn storage_state_modified_ms(path: PathBuf) -> Option<u64> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as u64)
}

fn build_script_output(output: Output) -> ScriptOutput {
    ScriptOutput {
        success: output.status.success(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: decode_output(output.stdout),
        stderr: decode_output(output.stderr),
    }
}
