use super::*;

pub(super) fn migrate(conn: &Connection, path: &Path) -> Result<()> {
    create_migration_backup(conn, path, 15)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(crate::session_collaboration::SCHEMA)?;
    let has_column: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('turn_queue') WHERE name = 'session_message_id')",
        [],
        |row| row.get(0),
    )?;
    if !has_column {
        tx.execute_batch("ALTER TABLE turn_queue ADD COLUMN session_message_id TEXT;")?;
    }
    // A v15 file walks the later steps in the same launch (plugin providers
    // then the turn-queue priority block), so this step only stamps its own
    // version.
    tx.pragma_update(None, "user_version", 16)?;
    tx.commit()
        .context("commit session collaboration migration")?;
    Ok(())
}

pub(super) fn migrate_v27_to_v28(conn: &Connection, path: &Path) -> Result<()> {
    let backup = create_migration_backup(conn, path, 27)?;
    let tx = conn.unchecked_transaction()?;
    let has_column: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('session_collaboration_messages') WHERE name='external_write_ceiling')",
        [], |row| row.get(0))?;
    if !has_column {
        tx.execute_batch(
            "ALTER TABLE session_collaboration_messages ADD COLUMN external_write_ceiling TEXT;",
        )?;
    }
    tx.pragma_update(None, "user_version", 28)?;
    tx.commit().with_context(|| {
        format!(
            "commit schema v27 to v28 migration; backup {} remains",
            backup.display()
        )
    })?;
    Ok(())
}
