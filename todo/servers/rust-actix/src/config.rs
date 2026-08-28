// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::{Context, Result};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HydrationPlugin {
    WebUi,
    FastV3,
}

impl HydrationPlugin {
    pub(crate) fn app_id(self) -> &'static str {
        match self {
            Self::WebUi => "webui",
            Self::FastV3 => "webui-fast",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "webui" => Ok(Self::WebUi),
            "fast-v3" => Ok(Self::FastV3),
            _ => anyhow::bail!("Invalid --plugin '{value}'; expected 'webui' or 'fast-v3'"),
        }
    }
}

/// The response-mode dimension: `complete` always publishes exactly one
/// fully collected HTML response through `WebUIHandler::render`; the default
/// `progressive` preserves the existing native progressive/streaming
/// boundaries produced by `WebUIHandler::render_streaming`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseMode {
    Complete,
    Progressive,
}

impl ResponseMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Progressive => "progressive",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "complete" => Ok(Self::Complete),
            "progressive" => Ok(Self::Progressive),
            _ => anyhow::bail!(
                "Invalid --response-mode '{value}'; expected 'complete' or 'progressive'"
            ),
        }
    }
}

/// Configuration for the isolated one-worker Actix benchmark server.
pub struct ServerConfig {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) plugin: HydrationPlugin,
    pub(crate) protocol_path: PathBuf,
    pub(crate) response_mode: ResponseMode,
    pub(crate) states_path: PathBuf,
    pub(crate) tls: bool,
}

impl ServerConfig {
    /// Parse benchmark server options from command-line arguments.
    pub fn from_args<I>(args: I) -> Result<Self>
    where
        I: IntoIterator<Item = String>,
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut config = Self {
            host: "127.0.0.1".to_owned(),
            port: 3006,
            plugin: HydrationPlugin::WebUi,
            protocol_path: manifest_dir.join("../../apps/webui-lightdom/dist/protocol.bin"),
            response_mode: ResponseMode::Progressive,
            states_path: manifest_dir.join("../generated/todo-states.json"),
            tls: false,
        };
        let mut args = args.into_iter();
        while let Some(argument) = args.next() {
            if argument == "--tls" {
                config.tls = true;
                continue;
            }
            let value = args
                .next()
                .with_context(|| format!("{argument} requires a value"))?;
            match argument.as_str() {
                "--host" => config.host = value,
                "--port" => config.port = value.parse().context("Invalid --port")?,
                "--plugin" => config.plugin = HydrationPlugin::parse(&value)?,
                "--protocol" => config.protocol_path = PathBuf::from(value),
                "--response-mode" => config.response_mode = ResponseMode::parse(&value)?,
                "--states" => config.states_path = PathBuf::from(value),
                _ => anyhow::bail!("Unknown option '{argument}'"),
            }
        }
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::{HydrationPlugin, ResponseMode, ServerConfig};

    #[test]
    fn config_has_one_server_without_worker_override() {
        let result = ServerConfig::from_args([
            "--host".to_owned(),
            "127.0.0.2".to_owned(),
            "--port".to_owned(),
            "0".to_owned(),
        ]);
        let Ok(config) = result else {
            panic!("valid config should parse");
        };
        assert_eq!(config.host, "127.0.0.2");
        assert_eq!(config.port, 0);
        assert_eq!(config.plugin, HydrationPlugin::WebUi);
        assert_eq!(config.response_mode, ResponseMode::Progressive);
        assert!(!config.tls);
        let tls = ServerConfig::from_args(["--tls".to_owned()])
            .unwrap_or_else(|error| panic!("TLS flag should parse: {error}"));
        assert!(tls.tls);
        assert!(ServerConfig::from_args(["--workers".to_owned(), "2".to_owned()]).is_err());
    }

    #[test]
    fn config_selects_fast_v3_hydration() {
        let result = ServerConfig::from_args(["--plugin".to_owned(), "fast-v3".to_owned()]);
        let Ok(config) = result else {
            panic!("FAST V3 config should parse");
        };
        assert_eq!(config.plugin, HydrationPlugin::FastV3);
        assert_eq!(config.plugin.app_id(), "webui-fast");
        assert!(ServerConfig::from_args(["--plugin".to_owned(), "unknown".to_owned(),]).is_err());
    }

    #[test]
    fn config_defaults_to_progressive_and_parses_complete_response_mode() {
        let result =
            ServerConfig::from_args(["--response-mode".to_owned(), "complete".to_owned()]);
        let Ok(config) = result else {
            panic!("complete response mode should parse");
        };
        assert_eq!(config.response_mode, ResponseMode::Complete);
        assert_eq!(config.response_mode.as_str(), "complete");
        assert_eq!(ResponseMode::Progressive.as_str(), "progressive");
        assert!(ServerConfig::from_args([
            "--response-mode".to_owned(),
            "eventual".to_owned(),
        ])
        .is_err());
    }
}
