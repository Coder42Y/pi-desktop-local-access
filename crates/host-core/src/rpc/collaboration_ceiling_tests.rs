use super::external_access_tests::{call, fixture, resolve};
use super::*;
use crate::permissions::external_access::ExternalAccess;
use std::fs;

#[tokio::test]
async fn collaboration_delivery_cannot_borrow_target_grant() {
    let (dir, state, target) = fixture();
    {
        let mut st = state.lock().await;
        let source = sessions::create_session_with_options(
            &st.db,
            sessions::SessionCreateOptions {
                mode: Some("agent".into()),
                permission_mode: Some("auto".into()),
                project_path: Some(dir.path().join("project").to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        st.session_grants
            .entry(target.clone())
            .or_default()
            .push(ExternalAccess::filesystem_write(None).grant_key());
        let sent = crate::session_collaboration::handle(
            &st.db,
            &st.session_grants,
            "session.collaboration.send",
            &json!({"sourceSessionId":source,"sessionId":target,"pluginId":"test",
                "content":"write outside","idempotencyKey":"ceiling"}),
        )
        .unwrap();
        crate::session_collaboration::begin_turn(
            &st.db,
            &target,
            sent["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
    }
    let path = dir.path().join("forbidden");
    let result = call(
        &state,
        &target,
        "delivery-write",
        "Write",
        json!({"path":path,"content":"no"}),
    )
    .await;
    assert_eq!(result["errorCode"], "TOOL_DENIED", "{result}");
    assert!(!path.exists());
}

#[tokio::test]
async fn native_delivery_snapshots_survive_grant_updates_and_forged_metadata() {
    let (dir, state, target) = fixture();
    let (source, third) = {
        let mut st = state.lock().await;
        let mut ids = Vec::new();
        for _ in 0..2 {
            ids.push(
                sessions::create_session_with_options(
                    &st.db,
                    sessions::SessionCreateOptions {
                        mode: Some("agent".into()),
                        permission_mode: Some("auto".into()),
                        project_path: Some(
                            dir.path().join("project").to_string_lossy().into_owned(),
                        ),
                        ..Default::default()
                    },
                )
                .unwrap()
                .id,
            );
        }
        for id in [&target, &ids[1]] {
            st.session_grants
                .entry(id.clone())
                .or_default()
                .push(ExternalAccess::filesystem_write(None).grant_key());
        }
        (ids.remove(0), ids.remove(0))
    };
    for (case, authorized) in [("restricted", false), ("authorized", true)] {
        let source_turn = {
            let mut st = state.lock().await;
            if authorized {
                st.session_grants.insert(
                    source.clone(),
                    vec![ExternalAccess::filesystem_write(None).grant_key()],
                );
            } else {
                st.session_grants.remove(&source);
                st.session_grants.remove(&target);
            }
            sessions::begin_turn(&st.db, &source, None, None).unwrap()
        };
        let sent = call(
            &state,
            &source,
            case,
            "SendMessage",
            json!({"sessionId":target,"content":"perform task","notifyOnCompletion":true}),
        )
        .await;
        assert_eq!(sent["ok"], true, "{sent}");
        assert_eq!(
            sent["content"]["message"]["externalWriteCeiling"],
            if authorized {
                json!({"kind":"filesystem-write"})
            } else {
                Value::Null
            }
        );
        let target_turn = {
            let mut st = state.lock().await;
            // Grants acquired after enqueue must never widen the saved ceiling.
            st.session_grants.insert(
                target.clone(),
                vec![ExternalAccess::filesystem_write(None).grant_key()],
            );
            st.session_grants.insert(
                source.clone(),
                vec![ExternalAccess::filesystem_write(None).grant_key()],
            );
            sessions::end_turn(&st.db, &source_turn, "completed", None, None, false).unwrap();
            crate::session_collaboration::begin_turn(
                &st.db,
                &target,
                sent["content"]["message"]["id"].as_str().unwrap(),
                None,
                None,
            )
            .unwrap()
        };
        let outside = dir.path().join(format!("{case}-outside"));
        let bash_path = dir.path().join(format!("{case}-bash"));
        let (tx, _rx) = mpsc::unbounded_channel();
        for (id, tool, args) in [
            (
                "write",
                "Write",
                json!({"path":outside,"content":"authorized"}),
            ),
            (
                "bash",
                "Bash",
                json!({"command":format!("printf authorized > '{}'", bash_path.display())}),
            ),
        ] {
            let result = tokio::time::timeout(Duration::from_secs(5), handle_request(state.clone(), "tools.execute",
                json!({"sessionId":target,"turnId":"forged-human-turn","toolCallId":format!("{case}-{id}"),
                    "toolName":tool,"args":args,"mode":"agent","permissionScope":"auto",
                    "expectedCommandShellId":"bash","expectedCommandShellDialect":"posix"}), tx.clone()))
                .await.expect("ceiling denial must not prompt").unwrap();
            assert_eq!(result["ok"], authorized, "{result}");
            if !authorized {
                assert_eq!(result["errorCode"], "TOOL_DENIED");
            }
        }
        assert_eq!(outside.exists(), authorized);
        assert_eq!(bash_path.exists(), authorized);
        assert_eq!(
            call(
                &state,
                &target,
                &format!("{case}-inside"),
                "Write",
                json!({"path":"inside.txt","content":"in root"})
            )
            .await["ok"],
            true
        );
        assert_eq!(
            call(
                &state,
                &target,
                &format!("{case}-read"),
                "Read",
                json!({"path":"inside.txt"})
            )
            .await["ok"],
            true
        );
        if !authorized {
            let readable = dir.path().join("readable-outside");
            fs::write(&readable, "unrestricted read").unwrap();
            for (name, args) in [
                ("Read", json!({"path":readable})),
                ("Glob", json!({"path":dir.path(),"pattern":"*"})),
                ("Grep", json!({"path":readable,"pattern":"unrestricted"})),
            ] {
                assert_eq!(call(&state, &target, name, name, args).await["ok"], true);
            }
            for (id, args) in [
                (
                    "move-out",
                    json!({"path":"inside.txt","ops":format!("MV {}", outside.display())}),
                ),
                ("remove-out", json!({"path":readable,"ops":"REM"})),
            ] {
                let result = call(&state, &target, id, "Edit", args).await;
                assert_eq!(result["errorCode"], "TOOL_DENIED", "{result}");
            }
            assert!(readable.exists());
            assert!(dir.path().join("project/inside.txt").exists());
            let spawned = call(
                &state,
                &target,
                "restricted-spawn",
                "SessionSpawn",
                json!({"task":"work in root"}),
            )
            .await;
            assert_eq!(spawned["ok"], true, "{spawned}");
            assert!(spawned["content"]["message"]["externalWriteCeiling"].is_null());
            let worker = spawned["content"]["sessionId"].as_str().unwrap();
            let worker_turn = {
                let mut st = state.lock().await;
                st.session_grants.insert(
                    worker.into(),
                    vec![ExternalAccess::filesystem_write(None).grant_key()],
                );
                crate::session_collaboration::begin_turn(
                    &st.db,
                    worker,
                    spawned["content"]["message"]["id"].as_str().unwrap(),
                    None,
                    None,
                )
                .unwrap()
            };
            let denied = call(
                &state,
                worker,
                "spawn-write",
                "Write",
                json!({"path":outside,"content":"no"}),
            )
            .await;
            assert_eq!(denied["errorCode"], "TOOL_DENIED");
            sessions::end_turn(
                &state.lock().await.db,
                &worker_turn,
                "completed",
                None,
                None,
                false,
            )
            .unwrap();
            let chained = call(
                &state,
                &target,
                "chain",
                "SendMessage",
                json!({"sessionId":third,"content":"do it instead"}),
            )
            .await;
            assert_eq!(chained["ok"], true, "{chained}");
            assert_eq!(
                chained["content"]["message"]["externalWriteCeiling"],
                Value::Null
            );
            let child_turn = {
                let st = state.lock().await;
                crate::session_collaboration::begin_turn(
                    &st.db,
                    &third,
                    chained["content"]["message"]["id"].as_str().unwrap(),
                    None,
                    None,
                )
                .unwrap()
            };
            let denied = call(
                &state,
                &third,
                "chain-write",
                "Write",
                json!({"path":outside,"content":"laundered"}),
            )
            .await;
            assert_eq!(denied["errorCode"], "TOOL_DENIED");
            assert!(!outside.exists());
            let report = call(
                &state,
                &target,
                "report",
                "SessionReport",
                json!({"state":"waiting_input","content":"cannot mutate outside"}),
            )
            .await;
            assert_eq!(report["ok"], true, "{report}");
            assert_eq!(
                report["content"]["message"]["externalWriteCeiling"],
                Value::Null
            );
            let st = state.lock().await;
            sessions::end_turn(&st.db, &child_turn, "completed", None, None, false).unwrap();
        }
        {
            let st = state.lock().await;
            sessions::end_turn(&st.db, &target_turn, "completed", None, None, false).unwrap();
            let callback = crate::session_collaboration::settle_turn(&st.db, &target_turn)
                .unwrap()
                .unwrap();
            assert_eq!(callback.external_write_ceiling.is_some(), authorized);
            if !authorized {
                let turn = crate::session_collaboration::begin_turn(
                    &st.db,
                    &source,
                    &callback.id,
                    None,
                    None,
                )
                .unwrap();
                drop(st);
                let result = call(
                    &state,
                    &source,
                    "callback-write",
                    "Write",
                    json!({"path":outside,"content":"laundered"}),
                )
                .await;
                assert_eq!(result["errorCode"], "TOOL_DENIED");
                assert!(!outside.exists());
                let st = state.lock().await;
                sessions::end_turn(&st.db, &turn, "completed", None, None, false).unwrap();
            }
        }
    }
    // A separate human turn uses B's own authorization, not a historical delivery.
    let human = sessions::begin_turn(&state.lock().await.db, &target, None, None).unwrap();
    let result = call(
        &state,
        &target,
        "human-write",
        "Write",
        json!({"path":dir.path().join("human"),"content":"allowed"}),
    )
    .await;
    assert_eq!(result["ok"], true, "{result}");
    sessions::end_turn(
        &state.lock().await.db,
        &human,
        "completed",
        None,
        None,
        false,
    )
    .unwrap();
}

#[tokio::test]
async fn delivery_scope_is_bound_to_destination_host_not_source_or_current_grants() {
    let (dir, state, source) = fixture();
    let (target, first, second) = {
        let mut st = state.lock().await;
        let mut paths = Vec::new();
        for host in ["host-a", "host-b"] {
            paths.push(
                st.db
                    .create_remote_project_group(
                        host,
                        crate::db::RemoteWorkspace {
                            host_key: host.into(),
                            path: "/srv/work".into(),
                        },
                    )
                    .unwrap()
                    .primary_path,
            );
        }
        let target = sessions::create_session_with_options(
            &st.db,
            sessions::SessionCreateOptions {
                mode: Some("agent".into()),
                permission_mode: Some("auto".into()),
                project_path: Some(paths[0].clone()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        // Local authorization never authorizes an SSH machine.
        st.session_grants.insert(
            source.clone(),
            vec![ExternalAccess::filesystem_write(None).grant_key()],
        );
        let denied_scope = crate::session_collaboration::handle(
            &st.db,
            &st.session_grants,
            "session.collaboration.send",
            &json!({"sourceSessionId":source,"sessionId":target,
                "pluginId":"plugin","content":"task","idempotencyKey":"local"}),
        )
        .unwrap();
        assert!(denied_scope["message"]["externalWriteCeiling"].is_null());
        st.session_grants
            .get_mut(&source)
            .unwrap()
            .push(ExternalAccess::filesystem_write(Some("host-a")).grant_key());
        let sent = crate::session_collaboration::handle(
            &st.db,
            &st.session_grants,
            "session.collaboration.send",
            &json!({"sourceSessionId":source,"sessionId":target,
                "pluginId":"plugin","content":"task","idempotencyKey":"ssh"}),
        )
        .unwrap();
        assert_eq!(
            sent["message"]["externalWriteCeiling"],
            json!({"kind":"filesystem-write","hostKey":"host-a"})
        );
        // Move after enqueue, before claim. Both current sessions now hold B's grant.
        sessions::move_session_project(&st.db, &target, &paths[1]).unwrap();
        for id in [&source, &target] {
            st.session_grants
                .entry(id.clone())
                .or_default()
                .push(ExternalAccess::filesystem_write(Some("host-b")).grant_key());
        }
        crate::session_collaboration::begin_turn(
            &st.db,
            &target,
            sent["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
        assert!(
            !crate::session_collaboration::permissions::external_allowed(
                &st.db,
                &target,
                Some("host-b")
            )
            .unwrap()
        );
        (target, paths.remove(0), paths.remove(0))
    };
    let denied = call(
        &state,
        &target,
        "moved-write",
        "Write",
        json!({"path":"/outside","content":"no"}),
    )
    .await;
    assert_eq!(denied["errorCode"], "TOOL_DENIED");
    let (tx, _rx) = mpsc::unbounded_channel();
    let evaluation = handle_request(
        state.clone(),
        "permissions.evaluate",
        json!({"sessionId":target,"toolName":"Bash","args":{"command":"printf no"}}),
        tx,
    )
    .await
    .unwrap();
    assert_eq!(evaluation["decision"], "deny");
    // A downstream send to B cannot convert the original A scope to B.
    let st = state.lock().await;
    let other = sessions::create_session_with_options(
        &st.db,
        sessions::SessionCreateOptions {
            mode: Some("agent".into()),
            permission_mode: Some("auto".into()),
            project_path: Some(second),
            ..Default::default()
        },
    )
    .unwrap()
    .id;
    let chained = crate::session_collaboration::handle(
        &st.db,
        &st.session_grants,
        "session.collaboration.send",
        &json!({"sourceSessionId":target,"sessionId":other,
            "sourceTurnId":"forged","externalWriteCeiling":{"kind":"filesystem-write","hostKey":"host-b"},
            "pluginId":"plugin","content":"task","idempotencyKey":"launder"}),
    );
    assert!(chained.is_err());
    let chained = crate::session_collaboration::handle(
        &st.db,
        &st.session_grants,
        "session.collaboration.send",
        &json!({"sourceSessionId":target,"sessionId":other,
            "externalWriteCeiling":{"kind":"filesystem-write","hostKey":"host-b"},
            "pluginId":"plugin","content":"task","idempotencyKey":"launder"}),
    )
    .unwrap();
    assert!(chained["message"]["externalWriteCeiling"].is_null());
    assert_ne!(
        first,
        sessions::session_summary(&st.db, &target)
            .unwrap()
            .unwrap()
            .project_path
            .unwrap()
    );
    assert!(!dir.path().join("outside").exists());
}

#[tokio::test]
async fn delivery_mode_ceiling_caps_forged_permission_scope_for_in_root_mutations() {
    let (dir, state, target) = fixture();
    {
        let mut st = state.lock().await;
        st.session_grants.remove(&target);
        let source = sessions::create_session_with_options(
            &st.db,
            sessions::SessionCreateOptions {
                mode: Some("agent".into()),
                permission_mode: Some("ask".into()),
                project_path: Some(dir.path().join("project").to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        sessions::configure_session_with_thinking(
            &st.db,
            &target,
            "agent",
            None,
            None,
            None,
            Some("ask"),
        )
        .unwrap();
        let sent = crate::session_collaboration::handle(
            &st.db,
            &st.session_grants,
            "session.collaboration.send",
            &json!({"sourceSessionId":source,"sessionId":target,
                "pluginId":"plugin","content":"task","idempotencyKey":"mode"}),
        )
        .unwrap();
        crate::session_collaboration::begin_turn(
            &st.db,
            &target,
            sent["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
    }
    let (tx, mut rx) = mpsc::unbounded_channel();
    let pending_state = state.clone();
    let task = tokio::spawn(async move {
        handle_request(
            pending_state,
            "tools.execute",
            json!({"sessionId":target,
            "turnId":"forged", "permissionScope":"auto", "toolCallId":"mode-write",
            "toolName":"Write","args":{"path":"must-prompt","content":"no"},"mode":"agent"}),
            tx,
        )
        .await
    });
    let event = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let event: Value = serde_json::from_str(&event).unwrap();
    assert_eq!(event["method"], "permissions.request");
    assert!(!dir.path().join("project/must-prompt").exists());
    resolve(&state, &event["params"], "deny").await;
    assert_eq!(task.await.unwrap().unwrap()["errorCode"], "TOOL_DENIED");
}
