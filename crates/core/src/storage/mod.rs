use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use fs2::FileExt;
use crate::error::{CoreError, Result};
use crate::model::{AppPreferences, Collection, Environment, RequestItem};

pub struct StorageManager {
    base_dir: PathBuf,
}

impl StorageManager {
    pub fn default_storage_dir() -> PathBuf {
        if let Some(home) = dirs::home_dir() {
            home.join(".ezman")
        } else {
            PathBuf::from(".ezman")
        }
    }

    pub fn new() -> Result<Self> {
        Self::with_dir(Self::default_storage_dir())
    }

    pub fn with_dir(base_dir: impl AsRef<Path>) -> Result<Self> {
        let base_dir = base_dir.as_ref().to_path_buf();
        fs::create_dir_all(&base_dir)?;
        fs::create_dir_all(base_dir.join("collections"))?;
        fs::create_dir_all(base_dir.join("environments"))?;
        Ok(Self { base_dir })
    }

    fn lock_file(&self) -> Result<File> {
        let lock_path = self.base_dir.join(".lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        file.lock_exclusive()
            .map_err(|e| CoreError::LockError(format!("Failed to acquire file lock: {}", e)))?;
        Ok(file)
    }

    fn atomic_write(&self, target_path: &Path, content: &[u8]) -> Result<()> {
        let parent = target_path.parent().unwrap_or(&self.base_dir);
        let temp_file_path = parent.join(format!(".tmp_{}", uuid::Uuid::new_v4()));

        {
            let mut f = File::create(&temp_file_path)?;
            f.write_all(content)?;
            f.sync_all()?;
        }

        fs::rename(&temp_file_path, target_path)?;
        Ok(())
    }

    // --- Collections ---

    pub fn list_collections(&self) -> Result<Vec<Collection>> {
        let _lock = self.lock_file()?;
        let dir = self.base_dir.join("collections");
        let mut collections = Vec::new();

        if dir.exists() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    let mut file = File::open(&path)?;
                    let mut content = String::new();
                    file.read_to_string(&mut content)?;
                    if let Ok(col) = serde_json::from_str::<Collection>(&content) {
                        collections.push(col);
                    }
                }
            }
        }

        collections.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(collections)
    }

    pub fn get_collection(&self, id: &str) -> Result<Option<Collection>> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("collections").join(format!("{}.json", id));
        if !path.exists() {
            return Ok(None);
        }
        let mut file = File::open(path)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let col = serde_json::from_str::<Collection>(&content)?;
        Ok(Some(col))
    }

    pub fn save_collection(&self, collection: &Collection) -> Result<()> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("collections").join(format!("{}.json", collection.id));
        let json = serde_json::to_string_pretty(collection)?;
        self.atomic_write(&path, json.as_bytes())?;
        Ok(())
    }

    pub fn delete_collection(&self, id: &str) -> Result<bool> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("collections").join(format!("{}.json", id));
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // --- Environments ---

    pub fn list_environments(&self) -> Result<Vec<Environment>> {
        let _lock = self.lock_file()?;
        let dir = self.base_dir.join("environments");
        let mut environments = Vec::new();

        if dir.exists() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                    let mut file = File::open(&path)?;
                    let mut content = String::new();
                    file.read_to_string(&mut content)?;
                    if let Ok(env) = serde_json::from_str::<Environment>(&content) {
                        environments.push(env);
                    }
                }
            }
        }

        environments.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(environments)
    }

    pub fn get_environment(&self, id: &str) -> Result<Option<Environment>> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("environments").join(format!("{}.json", id));
        if !path.exists() {
            return Ok(None);
        }
        let mut file = File::open(path)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let env = serde_json::from_str::<Environment>(&content)?;
        Ok(Some(env))
    }

    pub fn save_environment(&self, environment: &Environment) -> Result<()> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("environments").join(format!("{}.json", environment.id));
        let json = serde_json::to_string_pretty(environment)?;
        self.atomic_write(&path, json.as_bytes())?;
        Ok(())
    }

    pub fn delete_environment(&self, id: &str) -> Result<bool> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("environments").join(format!("{}.json", id));
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // --- Preferences ---

    pub fn get_preferences(&self) -> Result<AppPreferences> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("preferences.json");
        if !path.exists() {
            return Ok(AppPreferences::default());
        }
        let mut file = File::open(path)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let prefs = serde_json::from_str::<AppPreferences>(&content).unwrap_or_default();
        Ok(prefs)
    }

    pub fn save_preferences(&self, prefs: &AppPreferences) -> Result<()> {
        let _lock = self.lock_file()?;
        let path = self.base_dir.join("preferences.json");
        let json = serde_json::to_string_pretty(prefs)?;
        self.atomic_write(&path, json.as_bytes())?;
        Ok(())
    }

    // --- Search Helper ---

    pub fn find_request(&self, request_id: &str) -> Result<Option<(Collection, RequestItem)>> {
        let collections = self.list_collections()?;
        for col in collections {
            if let Some(req) = col.find_request(request_id) {
                return Ok(Some((col.clone(), req.clone())));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::model::HttpMethod;

    #[test]
    fn test_storage_crud_collection() {
        let tmp = tempdir().unwrap();
        let storage = StorageManager::with_dir(tmp.path()).unwrap();

        let mut col = Collection::new("c1", "My API");
        let req = RequestItem::new("r1", "Get Status", HttpMethod::GET, "https://api.example.com/status");
        col.requests.push(req);

        storage.save_collection(&col).unwrap();

        let loaded = storage.get_collection("c1").unwrap().expect("collection exists");
        assert_eq!(loaded.name, "My API");
        assert_eq!(loaded.requests.len(), 1);

        let list = storage.list_collections().unwrap();
        assert_eq!(list.len(), 1);

        let (found_col, found_req) = storage.find_request("r1").unwrap().expect("request exists");
        assert_eq!(found_col.id, "c1");
        assert_eq!(found_req.id, "r1");

        let deleted = storage.delete_collection("c1").unwrap();
        assert!(deleted);
        assert!(storage.get_collection("c1").unwrap().is_none());
    }

    #[test]
    fn test_storage_crud_environment() {
        let tmp = tempdir().unwrap();
        let storage = StorageManager::with_dir(tmp.path()).unwrap();

        let env = Environment::new("e1", "Production");
        storage.save_environment(&env).unwrap();

        let loaded = storage.get_environment("e1").unwrap().expect("env exists");
        assert_eq!(loaded.name, "Production");

        let list = storage.list_environments().unwrap();
        assert_eq!(list.len(), 1);

        storage.delete_environment("e1").unwrap();
        assert!(storage.get_environment("e1").unwrap().is_none());
    }
}
