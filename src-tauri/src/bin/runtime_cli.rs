use std::time::Duration;

use tokio::signal::ctrl_c;
use tokio::time::sleep;
use ucas_classer::auth_runtime::{RuntimeService, RuntimeSnapshot};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("watch");
    let runtime = RuntimeService::new();

    match command {
        "watch" => watch_runtime(runtime).await,
        "status" => {
            print_snapshot(&runtime.snapshot());
            Ok(())
        }
        "check" => {
            let snapshot = runtime.run_explicit_check().await?;
            print_snapshot(&snapshot);
            Ok(())
        }
        "clear" => {
            let snapshot = runtime.run_clear().await?;
            print_snapshot(&snapshot);
            Ok(())
        }
        "login" => {
            let snapshot = runtime.trigger_interrupt_login().await?;
            print_snapshot(&snapshot);
            wait_for_login_to_finish(runtime).await
        }
        other => Err(format!(
            "unknown command `{other}`. Use: watch | status | check | clear | login"
        )),
    }
}

async fn watch_runtime(runtime: ucas_classer::auth_runtime::SharedRuntimeService) -> Result<(), String> {
    let snapshot = runtime.start_scheduler();
    println!("runtime scheduler started; press Ctrl+C to stop");
    print_snapshot(&snapshot);

    let mut last_snapshot = String::new();

    loop {
        tokio::select! {
            _ = ctrl_c() => {
                let snapshot = runtime.stop_scheduler();
                println!("runtime scheduler stopped");
                print_snapshot(&snapshot);
                return Ok(());
            }
            _ = sleep(Duration::from_secs(2)) => {
                let snapshot = runtime.snapshot();
                let rendered = render_snapshot(&snapshot);

                if rendered != last_snapshot {
                    println!("{rendered}");
                    last_snapshot = rendered;
                }
            }
        }
    }
}

async fn wait_for_login_to_finish(
    runtime: ucas_classer::auth_runtime::SharedRuntimeService,
) -> Result<(), String> {
    loop {
        let snapshot = runtime.snapshot();
        print_snapshot(&snapshot);

        if !snapshot.login_running {
            return Ok(());
        }

        sleep(Duration::from_secs(2)).await;
    }
}

fn print_snapshot(snapshot: &RuntimeSnapshot) {
    println!("{}", render_snapshot(snapshot));
}

fn render_snapshot(snapshot: &RuntimeSnapshot) -> String {
    format!("[{}] {}", format_now(), summarize_status(snapshot))
}

fn summarize_status(snapshot: &RuntimeSnapshot) -> String {
    if snapshot.login_running {
        return "LOGIN_REQUIRED".to_string();
    }

    if snapshot.reset_running {
        return "RESETTING".to_string();
    }

    if snapshot.explicit_check_running || snapshot.auth_check_running {
        return "CHECKING".to_string();
    }

    if snapshot.interrupt_flag {
        return "INTERRUPTED".to_string();
    }

    match snapshot.last_auth_check_ok {
        Some(true) => "ONLINE".to_string(),
        Some(false) => "OFFLINE".to_string(),
        None => "UNKNOWN".to_string(),
    }
}

fn format_now() -> String {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'",
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            String::from_utf8_lossy(&result.stdout).trim().to_string()
        }
        _ => "time-unavailable".to_string(),
    }
}
