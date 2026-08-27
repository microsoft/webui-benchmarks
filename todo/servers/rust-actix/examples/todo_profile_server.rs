// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use actix_web::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, App, HttpResponse, HttpServer};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use webui_handler::plugin::webui::WebUIHydrationPlugin;
use webui_handler::{Protocol, RenderOptions, ResponseWriter, WebUIHandler};

const STATE_VARIANT_COUNT: usize = 32;
const TODO_ITEM_COUNT: usize = 100;
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const CACHE_CONTROL_VALUE: &str = "no-store";

struct Config {
    host: String,
    port: u16,
    protocol_path: PathBuf,
    states_path: PathBuf,
}

impl Config {
    fn from_args() -> Result<Self> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut config = Self {
            host: "127.0.0.1".to_owned(),
            port: 0,
            protocol_path: manifest_dir
                .join("../../apps/webui-lightdom/dist/protocol.bin"),
            states_path: manifest_dir.join("../generated/todo-states.json"),
        };
        let mut args = std::env::args().skip(1);
        while let Some(name) = args.next() {
            let value = args
                .next()
                .with_context(|| format!("{name} requires a value"))?;
            match name.as_str() {
                "--host" => config.host = value,
                "--port" => config.port = value.parse().context("invalid --port")?,
                "--protocol" => config.protocol_path = PathBuf::from(value),
                "--states" => config.states_path = PathBuf::from(value),
                _ => anyhow::bail!("unknown option {name}"),
            }
        }
        Ok(config)
    }
}

struct StringWriter {
    output: String,
}

impl StringWriter {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            output: String::with_capacity(capacity),
        }
    }
}

impl ResponseWriter for StringWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        self.output.push_str(content);
        Ok(())
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_attribute(&mut self, name: &str, value: &str) -> webui_handler::Result<()> {
        self.output.push(' ');
        self.output.push_str(name);
        self.output.push_str("=\"");
        self.output.push_str(value);
        self.output.push('"');
        Ok(())
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_boolean_attribute(&mut self, name: &str) -> webui_handler::Result<()> {
        self.output.push(' ');
        self.output.push_str(name);
        Ok(())
    }

    fn end(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

#[derive(Default)]
struct CountWriter {
    bytes: usize,
}

impl ResponseWriter for CountWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        self.bytes += content.len();
        Ok(())
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_attribute(&mut self, name: &str, value: &str) -> webui_handler::Result<()> {
        self.bytes = self
            .bytes
            .saturating_add(name.len())
            .saturating_add(value.len())
            .saturating_add(4);
        Ok(())
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_boolean_attribute(&mut self, name: &str) -> webui_handler::Result<()> {
        self.bytes = self.bytes.saturating_add(name.len()).saturating_add(1);
        Ok(())
    }

    fn end(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

struct ProfileState {
    cached_body: web::Bytes,
    capacity: usize,
    handler: WebUIHandler,
    protocol: Protocol,
    state: Value,
}

fn render_html(state: &ProfileState) -> Result<String> {
    let mut writer = StringWriter::with_capacity(state.capacity);
    state
        .handler
        .render(
            &state.protocol,
            &state.state,
            &RenderOptions::new("index.html", "/"),
            &mut writer,
        )
        .context("profile render failed")?;
    Ok(writer.output)
}

fn html_response(body: web::Bytes, mode: &'static str) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, HTML_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, CACHE_CONTROL_VALUE))
        .insert_header(("x-webui-profile-mode", mode))
        .body(body)
}

async fn dynamic(state: web::Data<ProfileState>) -> HttpResponse {
    match render_html(&state) {
        Ok(output) => html_response(web::Bytes::from(output), "render"),
        Err(error) => HttpResponse::InternalServerError().body(error.to_string()),
    }
}

async fn counted(state: web::Data<ProfileState>) -> HttpResponse {
    let mut writer = CountWriter::default();
    let result = state.handler.render(
        &state.protocol,
        &state.state,
        &RenderOptions::new("index.html", "/"),
        &mut writer,
    );
    match result {
        Ok(()) if writer.bytes == state.cached_body.len() => {
            html_response(state.cached_body.clone(), "counted")
        }
        Ok(()) => HttpResponse::InternalServerError().body("counted bytes changed"),
        Err(error) => HttpResponse::InternalServerError().body(error.to_string()),
    }
}

async fn cached(state: web::Data<ProfileState>) -> HttpResponse {
    html_response(state.cached_body.clone(), "cached")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Routes {
    cached: &'static str,
    counted: &'static str,
    dynamic: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Announcement {
    response_bytes: usize,
    routes: Routes,
    schema: &'static str,
    state_variant_count: usize,
    status: &'static str,
    todo_item_count: usize,
    url: String,
    worker_count: usize,
}

fn load_state(config: &Config) -> Result<web::Data<ProfileState>> {
    let protocol_bytes = std::fs::read(&config.protocol_path)
        .with_context(|| format!("failed to read {}", config.protocol_path.display()))?;
    let protocol = Protocol::from_protobuf(&protocol_bytes)
        .with_context(|| format!("failed to decode {}", config.protocol_path.display()))?;
    let state_bytes = std::fs::read(&config.states_path)
        .with_context(|| format!("failed to read {}", config.states_path.display()))?;
    let states: Vec<Value> =
        serde_json::from_slice(&state_bytes).context("failed to decode state pool")?;
    validate_states(&states)?;

    let state = states
        .into_iter()
        .next()
        .context("state pool unexpectedly became empty")?;
    let handler = WebUIHandler::with_plugin(|| Box::new(WebUIHydrationPlugin::new()));
    let bootstrap = ProfileState {
        cached_body: web::Bytes::new(),
        capacity: 256 * 1024,
        handler,
        protocol,
        state,
    };
    let output = render_html(&bootstrap)?;
    let capacity = output.len();
    Ok(web::Data::new(ProfileState {
        cached_body: web::Bytes::from(output),
        capacity,
        handler: bootstrap.handler,
        protocol: bootstrap.protocol,
        state: bootstrap.state,
    }))
}

fn validate_states(states: &[Value]) -> Result<()> {
    if states.len() != STATE_VARIANT_COUNT {
        anyhow::bail!(
            "expected {STATE_VARIANT_COUNT} states, received {}",
            states.len()
        );
    }
    for (index, state) in states.iter().enumerate() {
        if state.get("variantIndex").and_then(Value::as_u64) != Some(index as u64) {
            anyhow::bail!("state {index} has an invalid variantIndex");
        }
        if state.get("todos").and_then(Value::as_array).map(Vec::len) != Some(TODO_ITEM_COUNT) {
            anyhow::bail!("state {index} does not contain {TODO_ITEM_COUNT} todos");
        }
    }
    Ok(())
}

#[actix_web::main]
async fn main() -> Result<()> {
    let config = Config::from_args()?;
    let state = load_state(&config)?;
    let response_bytes = state.cached_body.len();
    let host = config.host;
    let server = HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/dynamic", web::get().to(dynamic))
            .route("/counted", web::get().to(counted))
            .route("/cached", web::get().to(cached))
    })
    .workers(1)
    .bind((host.as_str(), config.port))
    .with_context(|| format!("failed to bind {}:{}", host, config.port))?;
    let port = server
        .addrs()
        .first()
        .context("Actix did not expose a profile address")?
        .port();
    println!(
        "{}",
        serde_json::to_string(&Announcement {
            response_bytes,
            routes: Routes {
                cached: "/cached",
                counted: "/counted",
                dynamic: "/dynamic",
            },
            schema: "webui.ssr-todo-actix-profile/v1",
            state_variant_count: STATE_VARIANT_COUNT,
            status: "ready",
            todo_item_count: TODO_ITEM_COUNT,
            url: format!("http://{host}:{port}"),
            worker_count: 1,
        })?
    );
    server.run().await.context("Actix profile server failed")
}

#[cfg(test)]
mod tests {
    use super::{validate_states, STATE_VARIANT_COUNT, TODO_ITEM_COUNT};
    use serde_json::{Map, Number, Value};

    #[test]
    fn validates_exact_profile_contract() {
        let states = (0..STATE_VARIANT_COUNT)
            .map(|variant_index| {
                let mut state = Map::new();
                state.insert(
                    "variantIndex".to_owned(),
                    Value::Number(Number::from(variant_index)),
                );
                state.insert(
                    "todos".to_owned(),
                    Value::Array(vec![Value::Null; TODO_ITEM_COUNT]),
                );
                Value::Object(state)
            })
            .collect::<Vec<_>>();
        assert!(validate_states(&states).is_ok());
        assert!(validate_states(&states[..STATE_VARIANT_COUNT - 1]).is_err());
    }
}
