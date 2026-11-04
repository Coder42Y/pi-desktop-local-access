//! Native collaboration authority. The historical plugin_id column is an owner
//! namespace here, not a fabricated plugin identity or plugin authorization.
use super::{repository, Message};
use crate::{
    db::{canonical_project_path, Database},
    session_worktrees, sessions,
};
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

pub const OWNER_ID: &str = "host:workspace-sessions";

fn denied() -> anyhow::Error {
    anyhow!("PERMISSION_DENIED: workspace session boundary")
}

/// Use the persisted project identity, never active UI workspace or an arbitrary
/// directory supplied by the caller. Worktree ownership stays with its project;
/// tool_root validates the registered isolated root rather than grouping by it.
fn identity(db: &Database, source: &str) -> Result<(i64, String)> {
    let row: Option<(i64, String)> = db
        .conn()
        .query_row(
            "SELECT p.id,p.path FROM sessions s JOIN projects p ON p.id=s.project_id
         WHERE s.id=?1 AND s.deleted_at IS NULL",
            [source],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (id, path) = row.ok_or_else(denied)?;
    let root = canonical_project_path(&path).ok_or_else(denied)?;
    session_worktrees::lifecycle::tool_root(db, source).map_err(|e| {
        if e.code == "WORKTREE_INTERNAL" {
            anyhow!("{e}")
        } else {
            anyhow!("PERMISSION_DENIED: {e}")
        }
    })?;
    Ok((id, root))
}

pub fn require_same_workspace(db: &Database, source: &str, target: &str) -> Result<()> {
    if identity(db, source)? != identity(db, target)? {
        return Err(denied());
    }
    Ok(())
}

// Boundary failures suppress delivery; unexpected storage failures stay observable.
pub(super) fn delivery_allowed(db: &Database, source: &str, target: &str) -> Result<bool> {
    match require_same_workspace(db, source, target) {
        Ok(()) => Ok(true),
        Err(error) if error.to_string().starts_with("PERMISSION_DENIED:") => Ok(false),
        Err(error) => Err(error),
    }
}

/// Recheck just before Main admits a queued native delivery. Turn claim repeats
/// the workspace check so a move after admission still fails closed.
pub fn validate_delivery(db: &Database, id: &str) -> Result<Value> {
    let message = repository::get(db, id)?.ok_or_else(|| anyhow!("NOT_FOUND: session message"))?;
    if message.plugin_id != OWNER_ID {
        return Err(anyhow!(
            "PERMISSION_DENIED: native session message required"
        ));
    }
    require_same_workspace(db, &message.source_session_id, &message.target_session_id)?;
    super::permissions::check_target(db, &message.target_session_id, &message.permission_ceiling)?;
    Ok(json!({"ok":true}))
}

fn active_turn(db: &Database, source: &str, claimed: Option<&str>) -> Result<String> {
    if sessions::session_mode(db, source)?.as_deref() != Some("agent") {
        return Err(anyhow!(
            "TOOL_DISABLED_IN_PLAN: workspace session tools require durable Agent mode"
        ));
    }
    let turns=db.conn().prepare_cached(
        "SELECT id FROM turns WHERE session_id=?1 AND status='running' ORDER BY started_at DESC LIMIT 2")?
        .query_map([source],|row| row.get::<_,String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if turns.len() != 1 || claimed.is_some_and(|id| id != turns[0]) {
        return Err(anyhow!(
            "PERMISSION_DENIED: actual running source turn required"
        ));
    }
    Ok(turns[0].clone())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct List {
    name: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Read {
    session_id: Option<String>,
    session_name: Option<String>,
    before: Option<i64>,
    limit: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Send {
    session_id: Option<String>,
    session_name: Option<String>,
    content: String,
    notify_on_completion: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Spawn {
    task: String,
    title: Option<String>,
    notify_on_completion: Option<bool>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    state: String,
    content: String,
}
fn parse<T: serde::de::DeserializeOwned>(args: &Value) -> Result<T> {
    serde_json::from_value(args.clone()).map_err(|e| anyhow!("INVALID_PARAMS: {e}"))
}
fn text(value: &str, max: usize) -> Result<()> {
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(anyhow!("INVALID_PARAMS: invalid text length"));
    }
    Ok(())
}

/// A failed lookup is structured data for disambiguation, never a create request.
#[derive(Debug)]
pub struct TargetResolutionError {
    pub name: String,
    pub candidates: Vec<Value>,
    pub has_more: bool,
}
impl std::fmt::Display for TargetResolutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.candidates.is_empty() {
            write!(f, "NOT_FOUND: no session currently has the name {:?}; refresh the directory or ask the user, never create implicitly", self.name)
        } else {
            write!(f, "CONFLICT: multiple sessions currently have the name {:?}; ask the user to choose a candidate ID before proceeding", self.name)
        }
    }
}
impl std::error::Error for TargetResolutionError {}

fn named_sessions(db: &Database, source: &str, name: &str) -> Result<(Vec<Value>, bool)> {
    let name =
        sessions::normalize_session_title(name).map_err(|e| anyhow!("INVALID_PARAMS: {e}"))?;
    let (project, _) = identity(db, source)?;
    // Exact current full titles, filtered in SQL before the bounded result. A
    // title lookup must not depend on whether the session is recently active.
    let mut rows = db.conn().prepare_cached(
        "SELECT s.id,s.title,s.updated_at,
         CASE WHEN EXISTS(SELECT 1 FROM turns t WHERE t.session_id=s.id AND t.status='running') THEN 'running' ELSE 'idle' END
         FROM sessions s WHERE s.project_id=?1 AND s.deleted_at IS NULL
         AND s.title=?2 COLLATE BINARY
         ORDER BY s.updated_at DESC,s.id DESC LIMIT 21")?
        .query_map(params![project,name], |row| Ok(json!({
            "id":row.get::<_,String>(0)?, "title":row.get::<_,String>(1)?,
            "updatedAt":crate::db::ms_to_ts(row.get(2)?), "status":row.get::<_,String>(3)?
        })))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = rows.len() > 20;
    rows.truncate(20);
    Ok((rows, has_more))
}

fn resolve_target(
    db: &Database,
    source: &str,
    id: Option<&str>,
    name: Option<&str>,
) -> Result<String> {
    match (id, name) {
        (Some(id), None) => {
            text(id, 256)?;
            Ok(id.to_owned())
        }
        (None, Some(name)) => {
            let (candidates, has_more) = named_sessions(db, source, name)?;
            if candidates.len() != 1 || has_more {
                return Err(TargetResolutionError {
                    name: name.trim().to_owned(),
                    candidates,
                    has_more,
                }
                .into());
            }
            let id = candidates[0]["id"]
                .as_str()
                .ok_or_else(|| anyhow!("INTERNAL: missing session identity"))?;
            require_same_workspace(db, source, id)?;
            Ok(id.to_owned())
        }
        _ => Err(anyhow!(
            "INVALID_PARAMS: supply exactly one of sessionId or sessionName"
        )),
    }
}

pub fn execute(
    db: &Database,
    source: &str,
    claimed_turn: Option<&str>,
    call: &str,
    name: &str,
    args: &Value,
) -> Result<Value> {
    let turn = active_turn(db, source, claimed_turn)?;
    let (project, _) = identity(db, source)?;
    text(call, 200)?;
    let key = format!("{name}:{call}");
    match name {
        "SessionList" => {
            let input: List = parse(args)?;
            if let Some(name) = input.name {
                let (sessions, has_more) = named_sessions(db, source, &name)?;
                let resolution = match sessions.len() {
                    0 => "not_found",
                    1 if !has_more => "unique",
                    _ => "ambiguous",
                };
                return Ok(json!({"sessions":sessions,"resolution":resolution,"hasMore":has_more}));
            }
            // Scope and deletion filtering happen before the SQL limit.
            let rows=db.conn().prepare_cached(
                "SELECT s.id,s.title,CASE WHEN EXISTS(SELECT 1 FROM turns t WHERE t.session_id=s.id AND t.status='running') THEN 'running' ELSE 'idle' END
                 FROM sessions s WHERE s.project_id=?1 AND s.id<>?2 AND s.deleted_at IS NULL AND s.mode='agent'
                 ORDER BY s.updated_at DESC,s.id DESC LIMIT 100")?
                .query_map(params![project,source],|row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut result = Vec::new();
            for (id, title, status) in rows {
                // Validate registered worktree state too; stale roots fail closed.
                if delivery_allowed(db, source, &id)? {
                    result.push(
                        json!({"id":id,"title":repository::bounded(&title,80),"status":status}),
                    );
                }
            }
            Ok(json!({"sessions":result}))
        }
        "SessionRead" => {
            let input: Read = parse(args)?;
            let target = resolve_target(
                db,
                source,
                input.session_id.as_deref(),
                input.session_name.as_deref(),
            )?;
            if input.before.is_some_and(|v| v < 0)
                || input.limit.is_some_and(|v| !(1..=50).contains(&v))
            {
                return Err(anyhow!("INVALID_PARAMS: invalid transcript window"));
            }
            require_same_workspace(db, source, &target)?;
            let detail = sessions::get_session_with_options(
                db,
                &target,
                sessions::SessionReadOptions {
                    message_before: input.before,
                    message_limit: Some(input.limit.unwrap_or(20)),
                    content_limit: Some(4000),
                    ..Default::default()
                },
            )?
            .ok_or_else(|| anyhow!("NOT_FOUND: session"))?;
            // Data-only projection: no model replay/system state, configuration,
            // runtime objects, nested tool payloads, or authorization framing.
            let messages = detail
                .messages
                .iter()
                .map(|m| {
                    json!({
                        "id":m.id,"role":m.role,"content":m.content,"createdAt":m.created_at,
                        "toolName":m.tool_name,"toolStatus":m.tool_status,"isError":m.is_error,
                        "sessionMessage":m.session_message
                    })
                })
                .collect::<Vec<_>>();
            Ok(
                json!({"sessionId":target,"sourceSessionId":target,"title":repository::bounded(&detail.summary.title,80),"messages":messages,
                "messageStart":detail.message_start,"messageEnd":detail.message_end,"hasMoreBefore":detail.has_more_before,"hasMoreAfter":detail.has_more_after}),
            )
        }
        "SendMessage" => {
            let input: Send = parse(args)?;
            let target = resolve_target(
                db,
                source,
                input.session_id.as_deref(),
                input.session_name.as_deref(),
            )?;
            text(&input.content, 64000)?;
            require_same_workspace(db, source, &target)?;
            send(
                db,
                source,
                &turn,
                &key,
                &target,
                &input.content,
                input.notify_on_completion.unwrap_or(false),
            )
        }
        "SessionSpawn" => {
            let input: Spawn = parse(args)?;
            text(&input.task, 64000)?;
            if let Some(title) = &input.title {
                text(title, 80)?;
            }
            let notify = input.notify_on_completion.unwrap_or(true);
            let title = input
                .title
                .unwrap_or_else(|| repository::bounded(input.task.trim(), 80));
            if let Some(existing) = repository::existing(db, OWNER_ID, source, &key)? {
                require_same_workspace(db, source, &existing.target_session_id)?;
                if existing.kind != "task"
                    || existing.content != input.task.trim()
                    || existing.notify_on_completion != notify
                    || existing.target_title != title
                {
                    return Err(anyhow!("IDEMPOTENCY_CONFLICT: spawn arguments changed"));
                }
                return Ok(json!({"sessionId":existing.target_session_id,"message":existing}));
            }
            let parent = sessions::session_summary(db, source)?.ok_or_else(denied)?;
            let spawned = super::spawn(
                db,
                &json!({"sourceSessionId":source,"sourceTurnId":turn,"pluginId":OWNER_ID,"idempotencyKey":key,
                "content":input.task,"title":title,"notifyOnCompletion":notify,"providerId":parent.provider_id,"modelId":parent.model_id}),
            )?;
            let id = spawned["message"]["id"]
                .as_str()
                .ok_or_else(|| anyhow!("INTERNAL: missing spawned delivery"))?;
            let message = repository::get(db, id)?
                .ok_or_else(|| anyhow!("INTERNAL: missing spawned delivery"))?;
            Ok(json!({"sessionId":message.target_session_id,"message":message}))
        }
        "SessionReport" => {
            let input: Report = parse(args)?;
            text(&input.content, 64000)?;
            if !matches!(input.state.as_str(), "phase_completed" | "waiting_input") {
                return Err(anyhow!("INVALID_PARAMS: invalid report state"));
            }
            let original=db.conn().prepare_cached(&format!("{} WHERE target_session_id=?1 AND turn_id=?2 AND status='running' AND notify_on_completion=1 AND kind<>'completion'",repository::SELECT))?
                .query_row(params![source,turn],repository::row).optional()?
                .ok_or_else(||anyhow!("PERMISSION_DENIED: current delivery has no completion subscription"))?;
            require_same_workspace(db, source, &original.source_session_id)?;
            let content = json!({"state":input.state,"content":input.content}).to_string();
            send(
                db,
                source,
                &turn,
                &key,
                &original.source_session_id,
                &content,
                false,
            )
        }
        _ => Err(anyhow!("INVALID_PARAMS: unknown workspace session tool")),
    }
}

fn send(
    db: &Database,
    source: &str,
    turn: &str,
    key: &str,
    target: &str,
    content: &str,
    notify: bool,
) -> Result<Value> {
    let tx = db.conn().unchecked_transaction()?;
    let message: Message = super::send_record(
        db,
        &json!({"pluginId":OWNER_ID,"sourceSessionId":source,"sourceTurnId":turn,
        "idempotencyKey":key,"content":content,"notifyOnCompletion":notify}),
        target,
        "message",
    )?;
    tx.commit()?;
    let message =
        repository::get(db, &message.id)?.ok_or_else(|| anyhow!("INTERNAL: missing delivery"))?;
    Ok(json!({"message":message}))
}
