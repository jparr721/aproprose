use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

#[derive(Debug)]
pub enum WriteFailure {
    BeforeReplacement {
        path: PathBuf,
        source: std::io::Error,
    },
    DurabilityUncertain {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl WriteFailure {
    pub fn replaced(&self) -> bool {
        matches!(self, Self::DurabilityUncertain { .. })
    }
}

impl std::fmt::Display for WriteFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BeforeReplacement { path, source } => write!(
                formatter,
                "cannot replace {}: {source} (original preserved)",
                path.display()
            ),
            Self::DurabilityUncertain { path, source } => write!(
                formatter,
                "replaced {} but durability uncertain: {source}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for WriteFailure {}

impl From<WriteFailure> for String {
    fn from(error: WriteFailure) -> Self {
        error.to_string()
    }
}

pub struct StagedWrite {
    destination: PathBuf,
    temporary: NamedTempFile,
}

pub fn stage(path: &Path, bytes: &[u8]) -> Result<StagedWrite, String> {
    stage_with(path, bytes, |file, content| {
        file.write_all(content)?;
        file.sync_all()
    })
}

fn stage_with(
    path: &Path,
    bytes: &[u8],
    write_content: impl FnOnce(&mut File, &[u8]) -> std::io::Result<()>,
) -> Result<StagedWrite, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("cannot stage {}: no parent directory", path.display()))?;
    let existing = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Some(metadata),
        Ok(_) => {
            return Err(format!(
                "cannot stage {}: destination is not a regular file",
                path.display()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "cannot inspect {} before replacement: {error}",
                path.display()
            ))
        }
    };
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("cannot stage {}: {error}", path.display()))?;
    if let Some(metadata) = existing {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| {
                format!(
                    "cannot preserve permissions for {}: {error}",
                    path.display()
                )
            })?;
    }
    write_content(temporary.as_file_mut(), bytes).map_err(|error| {
        format!(
            "cannot stage {} before replacement: {error}",
            path.display()
        )
    })?;
    Ok(StagedWrite {
        destination: path.to_path_buf(),
        temporary,
    })
}

impl StagedWrite {
    pub fn path(&self) -> &Path {
        &self.destination
    }

    pub fn commit(self) -> Result<(), WriteFailure> {
        self.commit_with_sync(sync_directory)
    }

    fn commit_with_sync(
        self,
        synchronize: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), WriteFailure> {
        let parent = self
            .destination
            .parent()
            .expect("staging requires a parent directory");
        replace(self.temporary, &self.destination).map_err(|source| {
            WriteFailure::BeforeReplacement {
                path: self.destination.clone(),
                source,
            }
        })?;
        synchronize(parent).map_err(|source| WriteFailure::DurabilityUncertain {
            path: self.destination,
            source,
        })
    }

    pub fn commit_new(self) -> Result<(), WriteFailure> {
        let parent = self
            .destination
            .parent()
            .expect("staging requires a parent directory");
        create_new(self.temporary, &self.destination).map_err(|source| {
            WriteFailure::BeforeReplacement {
                path: self.destination.clone(),
                source,
            }
        })?;
        sync_directory(parent).map_err(|source| WriteFailure::DurabilityUncertain {
            path: self.destination,
            source,
        })
    }
}

#[cfg(unix)]
fn sync_directory(parent: &Path) -> std::io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(windows))]
fn replace(temporary: NamedTempFile, destination: &Path) -> std::io::Result<()> {
    temporary
        .persist(destination)
        .map(|_file| ())
        .map_err(|error| error.error)
}

#[cfg(not(windows))]
fn create_new(temporary: NamedTempFile, destination: &Path) -> std::io::Result<()> {
    temporary
        .persist_noclobber(destination)
        .map(|_file| ())
        .map_err(|error| error.error)
}

#[cfg(windows)]
fn replace(temporary: NamedTempFile, destination: &Path) -> std::io::Result<()> {
    move_windows(temporary, destination, 0x1 | 0x8)
}

#[cfg(windows)]
fn create_new(temporary: NamedTempFile, destination: &Path) -> std::io::Result<()> {
    move_windows(temporary, destination, 0x8)
}

#[cfg(windows)]
fn move_windows(temporary: NamedTempFile, destination: &Path, flags: u32) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source = temporary.into_temp_path();
    let source_wide: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // Both NUL-terminated UTF-16 paths stay alive for the native call. WRITE_THROUGH
    // provides the Windows replacement durability boundary.
    let result = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), flags) };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn sync_directory(_parent: &Path) -> std::io::Result<()> {
    // MoveFileExW already synchronizes the replacement with WRITE_THROUGH.
    Ok(())
}

pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    stage(path, bytes)?
        .commit()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_staged_write_preserves_original_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chapter.tex");
        std::fs::write(&path, b"original").unwrap();
        let result = stage_with(&path, b"replacement", |_file, _bytes| {
            Err(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "injected write failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn sync_failure_after_replacement_reports_uncertain_durability() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chapter.tex");
        std::fs::write(&path, b"original").unwrap();
        let staged = stage(&path, b"replacement").unwrap();
        let error = staged
            .commit_with_sync(|_parent| Err(std::io::Error::other("injected sync failure")))
            .unwrap_err();
        assert!(
            error.to_string().contains("durability uncertain"),
            "{error}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
    }

    #[test]
    fn staged_write_does_not_replace_a_destination_directory() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chapter.tex");
        std::fs::create_dir(&path).unwrap();
        assert!(stage(&path, b"replacement").is_err());
        assert!(path.is_dir());
    }

    #[test]
    fn repeated_replacement_preserves_complete_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chapter.tex");
        write(&path, b"first").unwrap();
        write(&path, b"second").unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"second");
    }
}
