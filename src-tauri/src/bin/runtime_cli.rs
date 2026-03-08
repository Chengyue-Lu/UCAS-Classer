use std::time::Duration;
use std::{io, sync::mpsc, thread};

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
        "collect" => {
            println!("[{}] COLLECT_STARTING", format_now());
            let previous_import_finished_at_ms = runtime.snapshot().last_db_import_finished_at_ms;
            let snapshot = runtime.run_full_collect().await?;
            print_snapshot(&snapshot);
            if snapshot.last_collect_ok == Some(true) {
                println!("[{}] COLLECT_REFRESHED", format_now());
            }
            wait_for_db_import_to_settle(runtime, previous_import_finished_at_ms).await
        }
        "import" => {
            println!("[{}] DB_IMPORT_STARTING", format_now());
            let snapshot = runtime.run_db_import().await?;
            print_snapshot(&snapshot);
            if snapshot.last_db_import_ok == Some(true) {
                println!("[{}] DB_IMPORTED", format_now());
            }
            Ok(())
        }
        other => Err(format!(
            "unknown command `{other}`. Use: watch | status | check | clear | login | collect | import"
        )),
    }
}

async fn watch_runtime(runtime: ucas_classer::auth_runtime::SharedRuntimeService) -> Result<(), String> {
    let snapshot = runtime.start_scheduler();
    println!("runtime scheduler started; Ctrl+C to stop; r + Enter for cookie refresh due; c + Enter for collect refresh due; g + Enter to run collect; i + Enter to run db import");
    print_snapshot(&snapshot);

    let mut last_snapshot = String::new();
    let mut last_cookie_refresh_at_ms = snapshot.last_cookie_refresh_at_ms;
    let mut last_collect_finished_at_ms = snapshot.last_collect_finished_at_ms;
    let mut last_db_import_finished_at_ms = snapshot.last_db_import_finished_at_ms;
    let (input_tx, input_rx) = mpsc::channel::<String>();

    thread::spawn(move || loop {
        let mut line = String::new();
        if io::stdin().read_line(&mut line).is_err() {
            break;
        }

        if input_tx.send(line).is_err() {
            break;
        }
    });

    loop {
        tokio::select! {
            _ = ctrl_c() => {
                let snapshot = runtime.stop_scheduler();
                println!("runtime scheduler stopped");
                print_snapshot(&snapshot);
                return Ok(());
            }
            _ = sleep(Duration::from_secs(2)) => {
                while let Ok(command) = input_rx.try_recv() {
                    let normalized = command.trim().to_lowercase();
                    if normalized == "r" || normalized == "refresh" {
                        let snapshot = runtime.mark_hourly_refresh_due();
                        println!("[{}] COOKIE_REFRESH_DUE", format_now());
                        print_snapshot(&snapshot);
                    } else if normalized == "c" || normalized == "collect" {
                        let snapshot = runtime.mark_collect_refresh_due();
                        println!("[{}] COLLECT_REFRESH_DUE", format_now());
                        print_snapshot(&snapshot);
                    } else if normalized == "g" || normalized == "go" {
                        println!("[{}] COLLECT_STARTING", format_now());
                        let runtime_clone = runtime.clone();
                        tokio::spawn(async move {
                            let _ = runtime_clone.run_full_collect().await;
                        });
                    } else if normalized == "i" || normalized == "import" {
                        println!("[{}] DB_IMPORT_STARTING", format_now());
                        let runtime_clone = runtime.clone();
                        tokio::spawn(async move {
                            let _ = runtime_clone.run_db_import().await;
                        });
                    }
                }

                let snapshot = runtime.snapshot();
                let rendered = render_snapshot(&snapshot);

                if snapshot.last_cookie_refresh_at_ms != last_cookie_refresh_at_ms {
                    last_cookie_refresh_at_ms = snapshot.last_cookie_refresh_at_ms;
                    if last_cookie_refresh_at_ms.is_some() {
                        println!("[{}] COOKIE_REFRESHED", format_now());
                    }
                }

                if snapshot.last_collect_finished_at_ms != last_collect_finished_at_ms {
                    last_collect_finished_at_ms = snapshot.last_collect_finished_at_ms;
                    if snapshot.last_collect_ok == Some(true) {
                        println!("[{}] COLLECT_REFRESHED", format_now());
                    } else if snapshot.last_collect_ok == Some(false) {
                        println!("[{}] COLLECT_FAILED", format_now());
                    }
                }

                if snapshot.last_db_import_finished_at_ms != last_db_import_finished_at_ms {
                    last_db_import_finished_at_ms = snapshot.last_db_import_finished_at_ms;
                    if snapshot.last_db_import_ok == Some(true) {
                        println!("[{}] DB_IMPORTED", format_now());
                    } else if snapshot.last_db_import_ok == Some(false) {
                        println!("[{}] DB_IMPORT_FAILED", format_now());
                    }
                }

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

async fn wait_for_db_import_to_settle(
    runtime: ucas_classer::auth_runtime::SharedRuntimeService,
    previous_import_finished_at_ms: Option<u64>,
) -> Result<(), String> {
    for _ in 0..120 {
        let snapshot = runtime.snapshot();
        print_snapshot(&snapshot);

        let import_completed = snapshot.last_db_import_finished_at_ms != previous_import_finished_at_ms;
        if !snapshot.db_import_running && (!snapshot.db_import_due || import_completed) {
            if import_completed {
                if snapshot.last_db_import_ok == Some(true) {
                    println!("[{}] DB_IMPORTED", format_now());
                } else if snapshot.last_db_import_ok == Some(false) {
                    println!("[{}] DB_IMPORT_FAILED", format_now());
                }
            }
            return Ok(());
        }

        sleep(Duration::from_secs(1)).await;
    }

    Err("timed out while waiting for database import to settle".to_string())
}

fn print_snapshot(snapshot: &RuntimeSnapshot) {
    println!("{}", render_snapshot(snapshot));
}

fn render_snapshot(snapshot: &RuntimeSnapshot) -> String {
    format!("[{}] {}", format_now(), summarize_status(snapshot))
}

fn summarize_status(snapshot: &RuntimeSnapshot) -> String {
    if snapshot.collect_refresh_running {
        return "COLLECTING".to_string();
    }

    if snapshot.db_import_running {
        return "IMPORTING".to_string();
    }

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
