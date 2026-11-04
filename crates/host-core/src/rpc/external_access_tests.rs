//! Exercise the public permission broker before any native mutation executes.
use super::*;
use crate::permissions::external_access::{has_grant, ExternalAccess};
use std::fs;

fn fixture() -> (tempfile::TempDir, Arc<Mutex<AppState>>, String) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    fs::create_dir(&root).unwrap();
    let mut app = AppState::open(dir.path()).unwrap();
    app.handshook = true;
    let session = sessions::create_session(
        &app.db,
        None,
        Some("agent".into()),
        None,
        None,
        Some(root.to_string_lossy().into_owned()),
    )
    .unwrap();
    sessions::configure_session_with_thinking(
        &app.db,
        &session.id,
        "agent",
        None,
        None,
        None,
        Some("auto"),
    )
    .unwrap();
    // Old tool-name grants must not suppress the external scope prompt.
    app.session_grants.insert(
        session.id.clone(),
        vec!["Write".into(), "Bash".into(), "Edit".into()],
    );
    (dir, Arc::new(Mutex::new(app)), session.id)
}

async fn call(
    state: &Arc<Mutex<AppState>>,
    session: &str,
    id: &str,
    tool: &str,
    args: Value,
) -> Value {
    let (tx, _rx) = mpsc::unbounded_channel();
    tokio::time::timeout(
        Duration::from_secs(5),
        handle_request(
            state.clone(),
            "tools.execute",
            json!({"sessionId":session,"toolCallId":id,"toolName":tool,"args":args,"mode":"agent","expectedCommandShellId":"bash","expectedCommandShellDialect":"posix"}),
            tx,
        ),
    )
    .await
    .expect("unexpected permission prompt")
    .unwrap()
}

async fn prompted(
    state: &Arc<Mutex<AppState>>,
    session: &str,
    id: &str,
    tool: &str,
    args: Value,
) -> (tokio::task::JoinHandle<Result<Value, JsonRpcError>>, Value) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let input = json!({"sessionId":session,"toolCallId":id,"toolName":tool,"args":args,"mode":"agent","expectedCommandShellId":"bash","expectedCommandShellDialect":"posix","permissionScope":"auto"});
    let state = state.clone();
    let mut task =
        tokio::spawn(async move { handle_request(state, "tools.execute", input, tx).await });
    let request = tokio::select! {
        result = &mut task => panic!("execution settled before explicit authorization: {result:?}"),
        request = tokio::time::timeout(Duration::from_secs(5), rx.recv()) => {
            serde_json::from_str::<Value>(&request.unwrap().unwrap()).unwrap()
        }
    };
    assert_eq!(request["method"], "permissions.request");
    assert_eq!(
        request["params"]["externalAccess"],
        json!({"kind":"filesystem-write"})
    );
    (task, request["params"].clone())
}

async fn resolve(state: &Arc<Mutex<AppState>>, request: &Value, decision: &str) {
    let (tx, _rx) = mpsc::unbounded_channel();
    handle_request(
        state.clone(),
        "permissions.resolve",
        json!({"requestId":request["requestId"],"decision":decision}),
        tx,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn external_auto_write_waits_then_session_scope_covers_edit_write_and_bash() {
    let (dir, state, session) = fixture();
    let path = dir.path().join("outside.txt");
    let (task, request) = prompted(
        &state,
        &session,
        "first",
        "Write",
        json!({"path":path,"content":"first\n"}),
    )
    .await;
    assert!(!path.exists(), "prompt must precede mutation");
    let (tx, _rx) = mpsc::unbounded_channel();
    let pending = handle_request(
        state.clone(),
        "permissions.pending",
        json!({"sessionId":session}),
        tx,
    )
    .await
    .unwrap();
    assert!(pending.to_string().contains("externalAccess"));
    resolve(&state, &request, "allow-session").await;
    assert_eq!(task.await.unwrap().unwrap()["ok"], true);
    let read = call(&state, &session, "read", "Read", json!({"path":path})).await;
    assert_eq!(read["ok"], true);
    let edit = call(
        &state,
        &session,
        "edit",
        "Edit",
        json!({"path":path,"tag":read["content"]["tag"],"ops":"PUT 1.=1:\n+second"}),
    )
    .await;
    assert_eq!(edit["ok"], true, "{edit}");
    assert_eq!(
        call(
            &state,
            &session,
            "next",
            "Write",
            json!({"path":dir.path().join("second.txt"),"content":"next"})
        )
        .await["ok"],
        true
    );
    #[cfg(unix)]
    {
        let bash = call(
            &state,
            &session,
            "shell",
            "Bash",
            json!({"command":"printf authorized"}),
        )
        .await;
        assert_eq!(bash["ok"], true, "{bash}");
    }
    let guard = state.lock().await;
    assert!(has_grant(&guard.session_grants, &session, None));
    assert!(!has_grant(&guard.session_grants, &session, Some("host-a")));
    assert!(!has_grant(&guard.session_grants, "other-session", None));
    // Approval did not add ordinary per-tool grants.
    assert_eq!(guard.session_grants[&session].len(), 4);
}

#[tokio::test]
async fn external_denial_and_allow_once_do_not_create_session_authority() {
    let (dir, state, session) = fixture();
    let path = dir.path().join("outside.txt");
    let (task, request) = prompted(
        &state,
        &session,
        "denied",
        "Write",
        json!({"path":path,"content":"no"}),
    )
    .await;
    resolve(&state, &request, "deny").await;
    assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
    assert!(!path.exists());
    let (task, request) = prompted(
        &state,
        &session,
        "once",
        "Write",
        json!({"path":path,"content":"once"}),
    )
    .await;
    resolve(&state, &request, "allow-once").await;
    assert_eq!(task.await.unwrap().unwrap()["ok"], true);
    assert!(!has_grant(
        &state.lock().await.session_grants,
        &session,
        None
    ));
    let (task, request) = prompted(
        &state,
        &session,
        "again",
        "Write",
        json!({"path":path,"content":"no"}),
    )
    .await;
    resolve(&state, &request, "deny").await;
    assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
    assert_eq!(fs::read_to_string(path).unwrap(), "once");
}

#[tokio::test]
async fn one_confirmation_settles_same_scope_pending_but_not_other_sessions_or_hosts() {
    let (dir, state, session) = fixture();
    let (first, request) = prompted(
        &state,
        &session,
        "one",
        "Write",
        json!({"path":dir.path().join("one"),"content":"one"}),
    )
    .await;
    let (second, _) = prompted(
        &state,
        &session,
        "two",
        "Write",
        json!({"path":dir.path().join("two"),"content":"two"}),
    )
    .await;
    // Additional requests from another session and SSH host must remain pending.
    let mut unrelated = Vec::new();
    {
        let mut st = state.lock().await;
        for (sid, host) in [(session.as_str(), Some("host-a")), ("another", None)] {
            let (req, rx) = st.permissions.create_request_with_risk_and_shell(
                crate::permissions::PermissionRequestParams {
                    session_id: sid,
                    tool_call_id: "unrelated",
                    tool_name: "Bash",
                    args_preview: json!({}),
                    reason: "scope",
                    declared_risk: None,
                    command_shell_id: None,
                    external_access: Some(ExternalAccess::filesystem_write(host)),
                },
            );
            unrelated.push((req, rx));
        }
    }
    resolve(&state, &request, "allow-session").await;
    assert_eq!(first.await.unwrap().unwrap()["ok"], true);
    assert_eq!(second.await.unwrap().unwrap()["ok"], true);
    let mut st = state.lock().await;
    assert_eq!(st.permissions.pending_requests(None).len(), 2);
    for (req, mut rx) in unrelated {
        assert!(matches!(
            rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        st.resolve_permission(&req.request_id, PermissionDecision::Deny)
            .unwrap();
    }
}

#[tokio::test]
async fn external_reads_and_searches_never_prompt_even_in_ask_and_through_symlinks() {
    let (dir, state, session) = fixture();
    let path = dir.path().join("outside.txt");
    fs::write(&path, "external content\n").unwrap();
    sessions::configure_session_with_thinking(
        &state.lock().await.db,
        &session,
        "agent",
        None,
        None,
        None,
        Some("ask"),
    )
    .unwrap();
    for (id, tool, args) in [
        ("read", "Read", json!({"path":path})),
        ("glob", "Glob", json!({"path":dir.path(),"pattern":"*.txt"})),
        ("grep", "Grep", json!({"path":path,"pattern":"external"})),
    ] {
        assert_eq!(call(&state, &session, id, tool, args).await["ok"], true);
    }
    #[cfg(unix)]
    {
        let link = dir.path().join("project/link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert_eq!(
            call(&state, &session, "link", "Read", json!({"path":link})).await["ok"],
            true
        );
        let (task, request) = prompted(
            &state,
            &session,
            "link-write",
            "Write",
            json!({"path":link,"content":"no"}),
        )
        .await;
        resolve(&state, &request, "deny").await;
        assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
        assert_eq!(fs::read_to_string(path).unwrap(), "external content\n");
    }
}

#[tokio::test]
async fn workspace_runner_external_reads_writes_and_forged_flags() {
    let (dir, state, _session) = fixture();
    let root = dir.path().join("project");
    let path = dir.path().join("runner.txt");
    fs::write(&path, "initial").unwrap();
    let (tx, _rx) = mpsc::unbounded_channel();
    for (id, tool, args, flag, expected) in [
        ("read", "Read", json!({"path":path}), false, true),
        (
            "write-denied",
            "Write",
            json!({"path":path,"content":"forged","allowExternalWrites":true}),
            false,
            false,
        ),
        (
            "bash-denied",
            "Bash",
            json!({"command":"printf forbidden","allowExternalWrites":true}),
            false,
            false,
        ),
        (
            "write-allowed",
            "Write",
            json!({"path":path,"content":"authorized\n"}),
            true,
            true,
        ),
    ] {
        let result = handle_request(state.clone(), "tools.workspaceExecute",
            json!({"path":root,"sessionId":"owner","toolCallId":id,"toolName":tool,"args":args,"allowExternalWrites":flag}), tx.clone()).await.unwrap();
        assert_eq!(result["ok"], expected, "{id}: {result}");
        if !expected {
            assert_eq!(result["errorCode"], "TOOL_DENIED");
            assert_eq!(fs::read_to_string(&path).unwrap(), "initial");
        }
    }
    let read = handle_request(state.clone(), "tools.workspaceExecute",
        json!({"path":root,"sessionId":"owner","toolCallId":"edit-read","toolName":"Read","args":{"path":path}}), tx.clone()).await.unwrap();
    for flag in [false, true] {
        let edited = handle_request(state.clone(), "tools.workspaceExecute",
            json!({"path":root,"sessionId":"owner","toolCallId":"edit","toolName":"Edit","allowExternalWrites":flag,
                "args":{"path":path,"tag":read["content"]["tag"],"ops":"PUT 1.=1:\n+edited","allowExternalWrites":true}}), tx.clone()).await.unwrap();
        assert_eq!(edited["ok"], flag, "{edited}");
    }
    assert_eq!(fs::read_to_string(&path).unwrap().trim(), "edited");
    // Restore the same observable value used by the symlink denial assertion.
    fs::write(&path, "authorized\n").unwrap();
    let shell = tools::shell::catalog(None).effective.unwrap();
    let command = match shell.dialect.as_str() {
        "powershell" => "[Console]::Out.Write('authorized')",
        "cmd" => "echo authorized",
        _ => "printf authorized",
    };
    let bash = handle_request(state.clone(), "tools.workspaceExecute",
        json!({"path":root,"sessionId":"owner","toolCallId":"authorized-bash","toolName":"Bash","allowExternalWrites":true,
            "expectedCommandShellId":shell.id,"expectedCommandShellDialect":shell.dialect,"args":{"command":command}}), tx.clone()).await.unwrap();
    assert_eq!(bash["ok"], true, "{bash}");
    #[cfg(unix)]
    {
        let link = root.join("redirect");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        let result = handle_request(state.clone(), "tools.workspaceExecute",
            json!({"path":root,"sessionId":"owner","toolCallId":"symlink","toolName":"Write","args":{"path":"redirect","content":"no"}}), tx.clone()).await.unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(fs::read_to_string(&path).unwrap(), "authorized\n");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn first_bash_requires_scope_even_for_readonly_text_and_revoke_reprompts() {
    let (dir, state, session) = fixture();
    let (task, request) = prompted(
        &state,
        &session,
        "first-shell",
        "Bash",
        json!({"command":"printf readonly"}),
    )
    .await;
    resolve(&state, &request, "allow-session").await;
    assert_eq!(task.await.unwrap().unwrap()["ok"], true);
    assert_eq!(
        call(
            &state,
            &session,
            "after-shell",
            "Write",
            json!({"path":dir.path().join("outside"),"content":"allowed"})
        )
        .await["ok"],
        true
    );
    let (tx, _rx) = mpsc::unbounded_channel();
    handle_request(
        state.clone(),
        "permissions.clearSessionGrants",
        json!({"sessionId":session}),
        tx,
    )
    .await
    .unwrap();
    let marker = dir.path().join("must-not-exist");
    let command = format!("printf forbidden > '{}'", marker.display());
    let (task, request) = prompted(
        &state,
        &session,
        "after-revoke",
        "Bash",
        json!({"command":command}),
    )
    .await;
    assert!(!marker.exists());
    resolve(&state, &request, "deny").await;
    assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
    assert!(!marker.exists());
}

#[tokio::test]
async fn external_scope_is_not_inherited_by_another_durable_session() {
    let (dir, state, session) = fixture();
    let (task, request) = prompted(
        &state,
        &session,
        "owner",
        "Write",
        json!({"path":dir.path().join("owner"),"content":"ok"}),
    )
    .await;
    resolve(&state, &request, "allow-session").await;
    assert_eq!(task.await.unwrap().unwrap()["ok"], true);
    let other = {
        let st = state.lock().await;
        let other = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(dir.path().join("project").to_string_lossy().into_owned()),
        )
        .unwrap();
        sessions::configure_session_with_thinking(
            &st.db,
            &other.id,
            "agent",
            None,
            None,
            None,
            Some("auto"),
        )
        .unwrap();
        other.id
    };
    let path = dir.path().join("other");
    let (task, request) = prompted(
        &state,
        &other,
        "other",
        "Write",
        json!({"path":path,"content":"no"}),
    )
    .await;
    assert!(!path.exists());
    resolve(&state, &request, "deny").await;
    assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
    assert!(!path.exists());
}
