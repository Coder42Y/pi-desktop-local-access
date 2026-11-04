use crate::{db::Database, sessions};
use anyhow::{anyhow, Result};

pub(super) fn effective_mode(db: &Database, session_id: &str) -> Result<String> {
    let mode = sessions::session_permission_mode(db, session_id)?
        .ok_or_else(|| anyhow!("NOT_FOUND: session {session_id}"))?;
    let mode = if mode != "inherit" {
        mode
    } else {
        db.get_setting("app")?
            .and_then(|settings| {
                settings
                    .get("defaultPermissionMode")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .filter(|mode| sessions::is_valid_permission_mode(mode) && mode != "inherit")
            .unwrap_or_else(|| "ask".into())
    };
    Ok(match active_delivery(db, session_id)? {
        Some(message) => restrict_mode(&mode, &message.permission_ceiling).to_owned(),
        None => mode,
    })
}

pub(super) fn check_target(db: &Database, session_id: &str, ceiling: &str) -> Result<()> {
    fn rank(mode: &str) -> u8 {
        match mode {
            "auto" => 2,
            "accept-edits" => 1,
            _ => 0,
        }
    }
    if rank(&effective_mode(db, session_id)?) > rank(ceiling) {
        return Err(anyhow!(
            "PERMISSION_DENIED: target permission mode exceeds the sending session's authorization"
        ));
    }
    if sessions::session_mode(db, session_id)?.as_deref() != Some("agent") {
        return Err(anyhow!(
            "PERMISSION_DENIED: session communication requires Agent mode"
        ));
    }
    Ok(())
}

pub fn restrict_mode<'a>(mode: &'a str, ceiling: &'a str) -> &'a str {
    fn rank(mode: &str) -> u8 {
        match mode {
            "auto" => 2,
            "accept-edits" => 1,
            _ => 0,
        }
    }
    if rank(mode) > rank(ceiling) {
        ceiling
    } else {
        mode
    }
}

/// The durable running turn, never caller turn metadata, owns this authority.
pub fn active_delivery(db: &Database, session: &str) -> Result<Option<super::Message>> {
    use rusqlite::OptionalExtension;
    Ok(db
        .conn()
        .prepare_cached(&format!(
            "{} WHERE target_session_id=?1 AND turn_id IN
         (SELECT id FROM turns WHERE session_id=?1 AND status='running')
         ORDER BY created_at DESC,rowid DESC LIMIT 1",
            super::repository::SELECT
        ))?
        .query_row([session], super::repository::row)
        .optional()?)
}

pub fn external_allowed(db: &Database, session: &str, host: Option<&str>) -> Result<bool> {
    use crate::permissions::external_access::ExternalAccess;
    Ok(active_delivery(db, session)?.is_none_or(|message| {
        message.external_write_ceiling == Some(ExternalAccess::filesystem_write(host))
    }))
}

pub(super) fn capture_external_scope(
    db: &Database,
    grants: &std::collections::HashMap<String, Vec<String>>,
    source: &str,
    target: &str,
) -> Result<Option<crate::permissions::external_access::ExternalAccess>> {
    use crate::permissions::external_access::{has_grant, ExternalAccess};
    let target = sessions::session_summary(db, target)?
        .ok_or_else(|| anyhow!("NOT_FOUND: target session"))?;
    let remote = target
        .project_path
        .as_deref()
        .map(|path| db.remote_workspace_for_path(path))
        .transpose()?
        .flatten();
    let host = remote.as_ref().map(|remote| remote.host_key.as_str());
    Ok(
        (has_grant(grants, source, host) && external_allowed(db, source, host)?)
            .then(|| ExternalAccess::filesystem_write(host)),
    )
}
