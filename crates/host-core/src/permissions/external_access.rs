//! Explicit, in-memory session authorization for arbitrary filesystem mutation.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExternalAccess {
    #[serde(rename = "filesystem-write")]
    FilesystemWrite {
        #[serde(rename = "hostKey", skip_serializing_if = "Option::is_none")]
        host_key: Option<String>,
    },
}

impl ExternalAccess {
    pub fn filesystem_write(host_key: Option<&str>) -> Self {
        Self::FilesystemWrite {
            host_key: host_key.map(str::to_owned),
        }
    }

    pub fn grant_key(&self) -> String {
        let Self::FilesystemWrite { host_key } = self;
        // Reserved namespace, distinct from every ordinary tool name. Local
        // remains distinct from even an empty or specially named SSH host.
        match host_key {
            None => "\0external-filesystem-write:local".into(),
            Some(key) => format!("\0external-filesystem-write:ssh:{key}"),
        }
    }
}

pub fn has_grant(
    grants: &HashMap<String, Vec<String>>,
    session_id: &str,
    host_key: Option<&str>,
) -> bool {
    let key = ExternalAccess::filesystem_write(host_key).grant_key();
    grants
        .get(session_id)
        .is_some_and(|values| values.contains(&key))
}
