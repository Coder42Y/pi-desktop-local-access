use super::tests::{params, run, session};
use super::*;
use crate::{db::Database, session_collaboration, sessions};
use serde_json::json;

#[tokio::test]
async fn renamed_names_resolve_in_an_active_conversation_without_creating_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let mut app = super::super::AppState::open(dir.path()).unwrap();
    app.handshook = true;
    let source = session(&app.db, project.path().to_str(), "agent", "ask");
    let target = session(&app.db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&app.db, &source, None, None).unwrap();
    sessions::rename_session(&app.db, &target, "Original name").unwrap();
    let state = std::sync::Arc::new(tokio::sync::Mutex::new(app));
    super::super::handle_request(
        state.clone(),
        "session.rename",
        json!({"id":target,"title":"接口排查"}),
        tokio::sync::mpsc::unbounded_channel().0,
    )
    .await
    .unwrap();
    let st = state.lock().await;
    let list = run(&st.db, &source, "SessionList", json!({"name":"接口排查"})).unwrap();
    assert_eq!(list["sessions"][0]["id"], target);
    assert!(run(
        &st.db,
        &source,
        "SessionList",
        json!({"name":"Original name"})
    )
    .unwrap()["sessions"]
        .as_array()
        .unwrap()
        .is_empty());
    let read = run(
        &st.db,
        &source,
        "SessionRead",
        json!({"sessionName":"接口排查"}),
    )
    .unwrap();
    assert_eq!(read["sessionId"], target);
    let sent = run(
        &st.db,
        &source,
        "SendMessage",
        json!({"sessionName":"接口排查","content":"Review","notifyOnCompletion":true}),
    )
    .unwrap();
    assert_eq!(sent["message"]["targetSessionId"], target);
    sessions::rename_session(&st.db, &target, "New phase").unwrap();
    let message = session_collaboration::get(&st.db, sent["message"]["id"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(message.target_session_id, target);
    let turn = session_collaboration::begin_turn(&st.db, &target, &message.id, None, None).unwrap();
    st.db
        .conn()
        .execute("UPDATE turns SET status='completed' WHERE id=?1", [&turn])
        .unwrap();
    let callback = session_collaboration::settle_turn(&st.db, &turn)
        .unwrap()
        .unwrap();
    assert_eq!(callback.source_session_id, target);
    assert_eq!(callback.target_session_id, source);
    assert_eq!(
        callback.reply_to_message_id.as_deref(),
        Some(message.id.as_str())
    );
    assert!(run(
        &st.db,
        &source,
        "SessionRead",
        json!({"sessionName":"接口排查"})
    )
    .is_err());
    assert_eq!(
        run(&st.db, &source, "SessionRead", json!({"sessionId":target})).unwrap()["sessionId"],
        target
    );
    let count: i64 = st
        .db
        .conn()
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn title_lookup_is_exact_scoped_and_not_limited_to_the_recent_directory() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let target = session(&db, project.path().to_str(), "agent", "ask");
    let foreign = session(&db, other.path().to_str(), "agent", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    let name = format!("分析{}", "界".repeat(78));
    sessions::rename_session(&db, &target, &name).unwrap();
    sessions::rename_session(&db, &foreign, &name).unwrap();
    db.conn()
        .execute("UPDATE sessions SET updated_at=0 WHERE id=?1", [&target])
        .unwrap();
    db.conn().execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<110)
      INSERT INTO sessions(id,title,project_id,created_at,updated_at) SELECT 'recent-'||x,'Recent',project_id,1,9999999999999 FROM n,sessions WHERE id=?1", [&source]).unwrap();
    assert!(
        !run(&db, &source, "SessionList", json!({})).unwrap()["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == target)
    );
    assert_eq!(
        run(&db, &source, "SessionRead", json!({"sessionName":name})).unwrap()["sessionId"],
        target
    );
    assert_eq!(
        run(&db, &source, "SessionList", json!({"name":name})).unwrap()["sessions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(run(&db, &source, "SessionRead", json!({"sessionName":"分析"})).is_err());
    assert!(run(
        &db,
        &source,
        "SessionRead",
        json!({"sessionId":target,"sessionName":name})
    )
    .is_err());
    assert!(run(&db, &source, "SessionRead", json!({})).is_err());
    db.conn()
        .execute("UPDATE sessions SET deleted_at=1 WHERE id=?1", [&target])
        .unwrap();
    assert!(run(&db, &source, "SessionRead", json!({"sessionName":name})).is_err());
}

#[tokio::test]
async fn ambiguous_session_names_return_candidates_and_never_send() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let mut app = super::super::AppState::open(dir.path()).unwrap();
    app.handshook = true;
    let source = session(&app.db, project.path().to_str(), "agent", "auto");
    let first = session(&app.db, project.path().to_str(), "agent", "ask");
    let second = session(&app.db, project.path().to_str(), "agent", "ask");
    sessions::begin_turn(&app.db, &source, None, None).unwrap();
    for id in [&first, &second] {
        sessions::rename_session(&app.db, id, "Same name").unwrap();
    }
    let state = std::sync::Arc::new(tokio::sync::Mutex::new(app));
    let (tx, _) = tokio::sync::mpsc::unbounded_channel();
    let p = params(
        &source,
        "SendMessage",
        json!({"sessionName":"Same name","content":"Do not deliver"}),
    );
    let result = execute(&state, &tx, &p, std::time::Instant::now()).await;
    assert!(!result.ok);
    assert_eq!(result.error_code.as_deref(), Some("CONFLICT"));
    let candidates = result.content["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 2);
    assert!(candidates.iter().any(|r| r["id"] == first));
    assert!(candidates.iter().any(|r| r["id"] == second));
    let st = state.lock().await;
    let count: i64 = st
        .db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn explicit_name_lookup_does_not_hide_same_named_current_or_plan_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let source = session(&db, project.path().to_str(), "agent", "ask");
    let target = session(&db, project.path().to_str(), "agent", "ask");
    let plan = session(&db, project.path().to_str(), "plan", "ask");
    sessions::begin_turn(&db, &source, None, None).unwrap();
    sessions::rename_session(&db, &source, "Shared name").unwrap();
    sessions::rename_session(&db, &target, "Shared name").unwrap();
    let listed = run(&db, &source, "SessionList", json!({"name":"Shared name"})).unwrap();
    assert_eq!(listed["resolution"], "ambiguous");
    assert_eq!(listed["sessions"].as_array().unwrap().len(), 2);
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionName":"Shared name","content":"No guess"})
    )
    .is_err());
    sessions::rename_session(&db, &plan, "Planning context").unwrap();
    assert_eq!(
        run(
            &db,
            &source,
            "SessionRead",
            json!({"sessionName":"Planning context"})
        )
        .unwrap()["sessionId"],
        plan
    );
    assert!(run(
        &db,
        &source,
        "SendMessage",
        json!({"sessionName":"Planning context","content":"Still requires Agent mode"})
    )
    .is_err());
}
