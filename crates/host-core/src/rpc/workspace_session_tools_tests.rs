use super::*;
use crate::{db::Database, session_collaboration, sessions};
use serde_json::{json, Value};

pub(super) fn session(db: &Database, path: Option<&str>, mode: &str, permission: &str) -> String {
    sessions::create_session_with_options(
        db,
        sessions::SessionCreateOptions {
            title: Some("Conversation".into()),
            mode: Some(mode.into()),
            project_path: path.map(str::to_owned),
            permission_mode: Some(permission.into()),
            ..Default::default()
        },
    )
    .unwrap()
    .id
}
pub(super) fn params(source: &str, name: &str, args: Value) -> crate::tools::ToolsExecuteParams {
    serde_json::from_value(json!({"sessionId":source,"toolCallId":"stable-call", "toolName":name,"args":args,"mode":"plan"})).unwrap()
}
pub(super) fn run(db: &Database, source: &str, name: &str, args: Value) -> anyhow::Result<Value> {
    execute_inner(db, &params(source, name, args))
}

#[test]
fn workspace_path_and_durable_turn_are_authoritative() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let path = project.path().to_str().unwrap();
    let source = session(&db, Some(path), "agent", "ask");
    let target = session(&db, Some(path), "agent", "ask");
    let foreign = session(&db, other.path().to_str(), "agent", "ask");
    let temporary = session(&db, None, "agent", "ask");
    assert!(run(&db, &source, "SessionList", json!({})).is_err());
    let turn = sessions::begin_turn(&db, &source, None, None).unwrap();
    let listed = run(&db, &source, "SessionList", json!({})).unwrap();
    assert_eq!(listed["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(listed["sessions"][0]["id"], target);
    for id in [&foreign, &temporary] {
        assert!(run(&db, &source, "SessionRead", json!({"sessionId":id})).is_err());
        assert!(run(
            &db,
            &source,
            "SendMessage",
            json!({"sessionId":id,"content":"hello"})
        )
        .is_err());
    }
    assert!(run(
        &db,
        &source,
        "SessionList",
        json!({"sourceSessionId":target})
    )
    .is_err());
    let mut delegated = params(&source, "SessionList", json!({}));
    delegated.delegation_id = Some("fake".into());
    assert!(execute_inner(&db, &delegated).is_err());
    let mut spoofed = params(&source, "SessionList", json!({}));
    spoofed.turn_id = Some("fake".into());
    assert!(execute_inner(&db, &spoofed).is_err());
    let sent = run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":target,"content":"hello"}),
    )
    .unwrap();
    assert_eq!(sent["message"]["notifyOnCompletion"], false);
    assert_eq!(sent["message"]["pluginId"], "host:workspace-sessions");
    assert_eq!(
        sent,
        run(
            &db,
            &source,
            "SendMessage",
            json!({"sessionId":target,"content":"hello"})
        )
        .unwrap()
    );
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":target,"content":"different"})
    )
    .is_err());
    let delivery = sent["message"]["id"].as_str().unwrap();
    session_collaboration::begin_turn(&db, &target, delivery, None, None).unwrap();
    assert!(run(
        &db,
        &target,
        "SessionReport",
        json!({"state":"waiting_input","content":"help"})
    )
    .is_err());
    db.conn()
        .execute("UPDATE sessions SET deleted_at=1 WHERE id=?1", [&target])
        .unwrap();
    assert!(run(&db, &source, "SessionRead", json!({"sessionId":target})).is_err());
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":target,"content":"hello"})
    )
    .is_err());
    assert!(
        run(&db, &source, "SessionList", json!({})).unwrap()["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    db.conn()
        .execute("UPDATE turns SET status='completed' WHERE id=?1", [turn])
        .unwrap();
    assert!(run(&db, &source, "SessionList", json!({})).is_err());
}

#[test]
fn spawn_report_completion_and_native_queue_revalidation() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    let spawned = run(
        &db,
        &source,
        "SessionSpawn",
        json!({"task":"Review", "title":"Worker"}),
    )
    .unwrap();
    assert_eq!(
        spawned,
        run(
            &db,
            &source,
            "SessionSpawn",
            json!({"task":"Review", "title":"Worker"})
        )
        .unwrap()
    );
    let child = spawned["sessionId"].as_str().unwrap();
    let message = spawned["message"]["id"].as_str().unwrap();
    let turn = session_collaboration::begin_turn(&db, child, message, None, None).unwrap();
    let report = run(
        &db,
        child,
        "SessionReport",
        json!({"state":"phase_completed","content":"Reviewed"}),
    )
    .unwrap();
    assert_eq!(report["message"]["targetSessionId"], source);
    assert_eq!(report["message"]["notifyOnCompletion"], false);
    assert_eq!(
        serde_json::from_str::<Value>(report["message"]["content"].as_str().unwrap()).unwrap()
            ["state"],
        "phase_completed"
    );
    assert!(run(
        &db,
        child,
        "SessionReport",
        json!({"state":"completed","content":"done"})
    )
    .is_err());
    db.conn()
        .execute("UPDATE turns SET status='completed' WHERE id=?1", [&turn])
        .unwrap();
    let receipt = session_collaboration::settle_turn(&db, &turn)
        .unwrap()
        .unwrap();
    assert_eq!(receipt.target_session_id, source);
    assert!(!receipt.notify_on_completion);
    assert_eq!(
        session_collaboration::settle_turn(&db, &turn)
            .unwrap()
            .unwrap()
            .id,
        receipt.id
    );
    // Changing persisted project identity invalidates native execution and callbacks.
    db.conn()
        .execute("UPDATE sessions SET project_id=NULL WHERE id=?1", [child])
        .unwrap();
    assert!(session_collaboration::begin_turn(&db, &source, &receipt.id, None, None).is_err());
}

#[test]
fn transcript_paging_is_bounded_and_data_only() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let target = session(&db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    for i in 0..55 {
        let ui=serde_json::from_value(json!({"id":format!("m{i}"),"role":"user","content":"x".repeat(5000),"createdAt":"2026-01-01T00:00:00Z"})).unwrap();
        sessions::append_message(&db, &target, &ui, None).unwrap();
    }
    let page = run(&db, &source, "SessionRead", json!({"sessionId":target})).unwrap();
    assert_eq!(page["sessionId"], target);
    assert_eq!(page["messages"].as_array().unwrap().len(), 20);
    assert_eq!(page["messageStart"], 35);
    assert_eq!(page["messageEnd"], 55);
    assert!(
        page["messages"][0]["content"]
            .as_str()
            .unwrap()
            .chars()
            .count()
            <= 4000
    );
    assert!(page.get("providerId").is_none());
    let older = run(
        &db,
        &source,
        "SessionRead",
        json!({"sessionId":target,"before":35,"limit":50}),
    )
    .unwrap();
    assert_eq!(older["messageStart"], 0);
    assert_eq!(older["messageEnd"], 35);
    for args in [
        json!({"sessionId":target,"limit":51}),
        json!({"sessionId":target,"before":-1}),
        json!({"sessionId":target,"limit":1.5}),
    ] {
        assert!(run(&db, &source, "SessionRead", args).is_err());
    }
}

#[test]
fn native_modes_permissions_and_argument_validation() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let elevated = session(&db, project.path().to_str(), "agent", "auto");
    let plan = session(&db, project.path().to_str(), "plan", "ask");
    let temporary = session(&db, None, "agent", "ask");
    for id in [&source, &plan, &temporary] {
        sessions::begin_turn(&db, id, None, None).unwrap();
    }
    assert!(run(&db, &plan, "SessionList", json!({})).is_err());
    assert!(
        !run(&db, &source, "SessionList", json!({})).unwrap()["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == plan)
    );
    assert!(run(&db, &temporary, "SessionList", json!({})).is_err());
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":elevated,"content":"escalate"})
    )
    .is_err());
    for args in [
        json!({"task":"x","providerId":"fake"}),
        json!({"task":"x","notifyOnCompletion":"yes"}),
        json!({"task":"x".repeat(64001)}),
        json!({"task":"x","title":"x".repeat(81)}),
    ] {
        assert!(run(&db, &source, "SessionSpawn", args).is_err());
    }
    let permissions = crate::permissions::PermissionManager::default();
    let grants = std::collections::HashMap::new();
    for tool in [
        "SessionList",
        "SessionRead",
        "SendMessage",
        "SessionSpawn",
        "SessionReport",
    ] {
        assert!(matches!(
            permissions.evaluate_auto_with_permission_mode("s", tool, "plan", "auto", &grants),
            Some(crate::permissions::PermissionDecision::Deny)
        ));
        let decision =
            permissions.evaluate_auto_with_permission_mode("s", tool, "agent", "ask", &grants);
        if matches!(tool, "SessionList" | "SessionRead") {
            assert!(decision.is_some());
        } else {
            assert!(decision.is_none());
        }
    }
}

#[test]
fn list_scopes_before_limit_and_bounds_titles() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let foreign = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let other = session(&db, foreign.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    db.conn()
        .execute(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<105)
        INSERT INTO sessions(id,title,project_id,created_at,updated_at)
        SELECT 'same-'||x,?2,project_id,1,1 FROM n,sessions WHERE id=?1",
            rusqlite::params![source, "x".repeat(200)],
        )
        .unwrap();
    db.conn()
        .execute(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<110)
        INSERT INTO sessions(id,title,project_id,created_at,updated_at)
        SELECT 'foreign-'||x,'foreign',project_id,1,9999999999999 FROM n,sessions WHERE id=?1",
            [other],
        )
        .unwrap();
    let listed = run(&db, &source, "SessionList", json!({})).unwrap();
    let rows = listed["sessions"].as_array().unwrap();
    assert_eq!(rows.len(), 100);
    assert!(rows
        .iter()
        .all(|r| r["id"].as_str().unwrap().starts_with("same-")
            && r["title"].as_str().unwrap().len() == 80));
}

#[test]
fn native_callbacks_fail_closed_on_workspace_move_and_spawn_freezes_permissions() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    db.set_setting("app", &json!({"defaultPermissionMode":"ask"}))
        .unwrap();
    let source = session(&db, project.path().to_str(), "agent", "inherit");
    db.conn().execute("UPDATE sessions SET provider_id='provider',model_id='model',thinking_level='high' WHERE id=?1",[&source]).unwrap();
    sessions::begin_turn(&db, &source, None, None).unwrap();
    let spawned = run(&db, &source, "SessionSpawn", json!({"task":"Do work"})).unwrap();
    let child = spawned["sessionId"].as_str().unwrap();
    let summary = sessions::session_summary(&db, child).unwrap().unwrap();
    assert_eq!(summary.provider_id.as_deref(), Some("provider"));
    assert_eq!(summary.model_id.as_deref(), Some("model"));
    assert_eq!(summary.thinking_level, "high");
    assert_eq!(summary.permission_mode, "ask");
    db.set_setting("app", &json!({"defaultPermissionMode":"auto"}))
        .unwrap();
    assert_eq!(
        sessions::session_permission_mode(&db, child)
            .unwrap()
            .as_deref(),
        Some("ask")
    );
    let turn = session_collaboration::begin_turn(
        &db,
        child,
        spawned["message"]["id"].as_str().unwrap(),
        None,
        None,
    )
    .unwrap();
    db.conn()
        .execute("UPDATE sessions SET project_id=NULL WHERE id=?1", [&source])
        .unwrap();
    assert!(run(
        &db,
        child,
        "SessionReport",
        json!({"state":"waiting_input","content":"Need help"})
    )
    .is_err());
    db.conn()
        .execute("UPDATE turns SET status='completed' WHERE id=?1", [&turn])
        .unwrap();
    assert!(session_collaboration::settle_turn(&db, &turn)
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn ordinary_rpc_path_lists_sends_notifies_and_preserves_workspace() {
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let mut st = super::super::AppState::open(dir.path()).unwrap();
    st.handshook = true;
    st.db
        .set_setting("app", &json!({"defaultPermissionMode":"auto"}))
        .unwrap();
    let source = session(&st.db, project.path().to_str(), "agent", "auto");
    let target = session(&st.db, project.path().to_str(), "agent", "ask");
    let turn = sessions::begin_turn(&st.db, &source, None, None).unwrap();
    let active = st.workspace.set(other.path()).path;
    let state = Arc::new(Mutex::new(st));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let listed = super::super::handle_request(state.clone(), "tools.list", json!({}), tx.clone())
        .await
        .unwrap();
    for name in [
        "SessionList",
        "SessionRead",
        "SendMessage",
        "SessionSpawn",
        "SessionReport",
    ] {
        assert!(listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["name"] == name));
    }
    let result=super::super::handle_request(state.clone(),"tools.execute",json!({"sessionId":source,"turnId":turn,"toolCallId":"rpc-send","toolName":"SendMessage","args":{"sessionId":target,"content":"Hello"},"mode":"plan"}),tx.clone()).await.unwrap();
    assert_eq!(result["ok"], true, "{result}");
    let mut changed = false;
    while let Ok(raw) = rx.try_recv() {
        let notice: Value = serde_json::from_str(&raw).unwrap();
        if notice["method"] == "session.collaboration.changed" {
            assert_eq!(notice["params"]["sessionId"], source);
            changed = true;
        }
    }
    assert!(changed);
    assert_eq!(state.lock().await.workspace.get().unwrap().path, active);
    // A caller-supplied auto scope cannot bypass the native session's Ask gate.
    state
        .lock()
        .await
        .db
        .conn()
        .execute(
            "UPDATE sessions SET permission_mode='ask' WHERE id=?1",
            [&source],
        )
        .unwrap();
    let call = super::super::handle_request(
        state.clone(),
        "tools.execute",
        json!({"sessionId":source,"turnId":turn,"toolCallId":"rpc-ask","toolName":"SendMessage","permissionScope":"auto","args":{"sessionId":target,"content":"Needs approval"},"mode":"agent"}),
        tx.clone(),
    );
    tokio::pin!(call);
    let request = loop {
        tokio::select! {
            result=&mut call => panic!("Ask was bypassed: {result:?}"),
            raw=rx.recv()=>{let notice:Value=serde_json::from_str(&raw.unwrap()).unwrap();if notice["method"]=="permissions.request" {break notice;}}
        }
    };
    let response = super::super::handle_request(
        state.clone(),
        "permissions.resolve",
        json!({"requestId":request["params"]["requestId"],"decision":"deny"}),
        tx,
    )
    .await;
    assert!(response.is_ok(), "{response:?}");
    let denied = call.await.unwrap();
    assert_eq!(denied["ok"], false);
}

#[test]
fn remote_project_identity_never_collapses_into_a_local_or_other_remote_root() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let one = db
        .create_remote_project_group(
            "One",
            crate::db::RemoteWorkspace {
                host_key: "host-one".into(),
                path: "/workspace".into(),
            },
        )
        .unwrap();
    let two = db
        .create_remote_project_group(
            "Two",
            crate::db::RemoteWorkspace {
                host_key: "host-two".into(),
                path: "/workspace".into(),
            },
        )
        .unwrap();
    let source = session(&db, Some(&one.primary_path), "agent", "ask");
    let same = session(&db, Some(&one.primary_path), "agent", "ask");
    let foreign = session(&db, Some(&two.primary_path), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    assert_eq!(
        run(&db, &source, "SessionList", json!({})).unwrap()["sessions"][0]["id"],
        same
    );
    assert!(run(&db, &source, "SessionRead", json!({"sessionId":same})).is_ok());
    assert!(run(&db, &source, "SessionRead", json!({"sessionId":foreign})).is_err());
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":foreign,"content":"No"})
    )
    .is_err());
}

#[test]
fn native_pending_query_and_dispatch_validation_reuse_the_host_ledger() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let target = session(&db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    let sent = run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":target,"content":"Review"}),
    )
    .unwrap();
    let id = sent["message"]["id"].as_str().unwrap();
    let pending = session_collaboration::handle(
        &db,
        "session.collaboration.pending",
        &json!({"sessionId":target}),
    )
    .unwrap();
    assert!(pending["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == id));
    assert_eq!(
        session_collaboration::handle(
            &db,
            "session.collaboration.validateNative",
            &json!({"messageId":id})
        )
        .unwrap()["ok"],
        true
    );
    db.conn()
        .execute("UPDATE sessions SET project_id=NULL WHERE id=?1", [&target])
        .unwrap();
    assert!(session_collaboration::handle(
        &db,
        "session.collaboration.validateNative",
        &json!({"messageId":id})
    )
    .is_err());
}

#[test]
fn bounded_history_preserves_agent_message_provenance() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let target = session(&db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    let sent = run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionId":target,"content":"Review"}),
    )
    .unwrap();
    let id = sent["message"]["id"].as_str().unwrap();
    let turn = session_collaboration::begin_turn(&db, &target, id, None, None).unwrap();
    let message = serde_json::from_value(
        json!({"id":"input","role":"user","content":"Review","createdAt":"2026-01-01T00:00:00Z"}),
    )
    .unwrap();
    sessions::append_message(&db, &target, &message, Some(&turn)).unwrap();
    let page = run(&db, &source, "SessionRead", json!({"sessionId":target})).unwrap();
    assert_eq!(
        page["messages"][0]["sessionMessage"]["sourceSessionId"],
        source
    );
    assert_eq!(page["messages"][0]["sessionMessage"]["messageId"], id);
}
