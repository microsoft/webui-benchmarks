// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

mod config;
mod metadata;

use actix_web::http::header::{HeaderName, HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use anyhow::{Context, Result};
use config::HydrationPlugin;
use metadata::{build_metadata, Announcement, ReadyMetadata};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use time::format_description::BorrowedFormatItem;
use time::macros::format_description;
use time::OffsetDateTime;
use webui_handler::plugin::fast_v3::FastV3HydrationPlugin;
use webui_handler::plugin::webui::WebUIHydrationPlugin;
use webui_handler::{Protocol, RenderOptions, ResponseWriter, WebUIHandler};

pub use config::ServerConfig;

const STATE_VARIANT_COUNT: usize = 32;
const ENTRY_ID: &str = "index.html";
const REQUEST_PATH: &str = "/";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const DYNAMIC_CACHE_CONTROL: &str = "no-store";
const CACHED_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";
const SERVER_SCHEMA: &str = "webui.ssr-todo-server/v1";
const INITIAL_CAPACITY: usize = 64 * 1024;
const PROFILE_TIMESTAMP: &str = "2000-01-01T00:00:00.000000Z";
const REQUEST_TIMESTAMP_FORMAT: &[BorrowedFormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:6]Z");

struct MemoryWriter {
    output: String,
}

impl MemoryWriter {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            output: String::with_capacity(capacity),
        }
    }
}

impl ResponseWriter for MemoryWriter {
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

/// Build the local self-signed TLS configuration used by HTTP/2 benchmarks.
pub fn local_http2_tls_config() -> Result<rustls::ServerConfig> {
    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_owned()])
        .context("Failed to create benchmark certificate parameters")?;
    params
        .subject_alt_names
        .push(rcgen::SanType::IpAddress(std::net::IpAddr::V4(
            std::net::Ipv4Addr::LOCALHOST,
        )));
    let key_pair = rcgen::KeyPair::generate().context("Failed to generate benchmark TLS key")?;
    let certificate = params
        .self_signed(&key_pair)
        .context("Failed to generate benchmark TLS certificate")?;
    let key = rustls::pki_types::PrivateKeyDer::try_from(key_pair.serialize_der())
        .map_err(|error| anyhow::anyhow!("Failed to serialize benchmark TLS key: {error}"))?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![certificate.der().clone()], key)
        .context("Failed to build benchmark TLS configuration")?;
    config.alpn_protocols = vec![b"h2".to_vec()];
    Ok(config)
}

struct StatePool {
    variants: Box<[Value]>,
    next_variant: usize,
}

impl StatePool {
    fn new(variants: Vec<Value>) -> Result<Self> {
        if variants.len() != STATE_VARIANT_COUNT {
            anyhow::bail!(
                "State pool must contain exactly {STATE_VARIANT_COUNT} variants, received {}",
                variants.len()
            );
        }
        for (expected, variant) in variants.iter().enumerate() {
            let actual = variant
                .get("variantIndex")
                .and_then(Value::as_u64)
                .and_then(|index| usize::try_from(index).ok());
            if actual != Some(expected) {
                anyhow::bail!("State pool variant {expected} must have variantIndex {expected}");
            }
        }
        Ok(Self {
            variants: variants.into_boxed_slice(),
            next_variant: 0,
        })
    }

    fn next_mut(&mut self) -> (usize, &mut Value) {
        let index = self.next_variant;
        self.next_variant = (self.next_variant + 1) % self.variants.len();
        (index, &mut self.variants[index])
    }
}

struct AppState {
    browser_assets: Option<BrowserAssets>,
    cached_body: web::Bytes,
    dynamic_capacity: usize,
    handler: WebUIHandler,
    metadata_body: web::Bytes,
    protocol: Protocol,
    states: Mutex<StatePool>,
    last_timestamp_micros: AtomicI64,
    variant_headers: Box<[HeaderValue]>,
    cached_timestamp_header: HeaderValue,
}

struct BrowserAssets {
    bootstrap: web::Bytes,
    components: web::Bytes,
    body_inject: String,
    styles: HashMap<String, web::Bytes>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

fn render_html(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    capacity: usize,
    body_inject: Option<&str>,
) -> Result<String> {
    let mut writer = MemoryWriter::with_capacity(capacity);
    let mut options = RenderOptions::new(ENTRY_ID, REQUEST_PATH);
    if let Some(content) = body_inject {
        options = options.with_body_inject(content);
    }
    handler
        .render(protocol, state, &options, &mut writer)
        .context("WebUI render failed")?;
    Ok(writer.output)
}

fn current_request_timestamp(last_timestamp_micros: &AtomicI64) -> Result<String> {
    let now_micros = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("System clock is before the Unix epoch")?
            .as_micros(),
    )
    .context("Current timestamp exceeds the supported range")?;
    let timestamp_micros = loop {
        let previous = last_timestamp_micros.load(Ordering::Relaxed);
        let next = now_micros.max(previous.saturating_add(1));
        if last_timestamp_micros
            .compare_exchange_weak(previous, next, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            break next;
        }
    };
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(timestamp_micros) * 1_000)
        .context("Current timestamp is outside the supported UTC range")?
        .format(REQUEST_TIMESTAMP_FORMAT)
        .context("Failed to format the current request timestamp")
}

fn materialize_request_state(base: &Value, request_timestamp: &str) -> Result<Value> {
    let mut state = base.clone();
    rewrite_request_state(&mut state, request_timestamp)?;
    Ok(state)
}

fn rewrite_request_state(state: &mut Value, request_timestamp: &str) -> Result<()> {
    let variant_index = state
        .get("variantIndex")
        .and_then(Value::as_u64)
        .context("Prepared state is missing variantIndex")?;
    let root = state
        .as_object_mut()
        .context("Prepared request state must be an object")?;
    let timestamp = string_field_mut_or_insert(root, "requestTimestamp")?;
    timestamp.clear();
    timestamp.push_str(request_timestamp);
    let todos = root
        .get_mut("todos")
        .and_then(Value::as_array_mut)
        .context("Prepared request state must contain todos")?;
    for (index, todo) in todos.iter_mut().enumerate() {
        rewrite_todo_timestamp(todo, index, variant_index, request_timestamp)?;
    }
    let footer = root
        .get_mut("footer")
        .and_then(Value::as_object_mut)
        .context("Prepared request state must contain footer")?;
    let label = string_field_mut_or_insert(footer, "requestTimestampLabel")?;
    label.clear();
    label.push_str("Rendered ");
    label.push_str(request_timestamp);
    Ok(())
}

fn rewrite_todo_timestamp(
    todo: &mut Value,
    index: usize,
    variant_index: u64,
    request_timestamp: &str,
) -> Result<()> {
    let todo = todo
        .as_object_mut()
        .context("Every structural todo must be an object")?;
    let item_number = index + 1;
    let title = string_field_mut(todo, "title")?;
    title.clear();
    write!(title, "Todo {item_number:04} · ")?;
    title.push_str(request_timestamp);

    let timestamp = string_field_mut(todo, "timestamp")?;
    timestamp.clear();
    timestamp.push_str(request_timestamp);

    let description = string_field_mut(todo, "description")?;
    description.clear();
    write!(
        description,
        "Dynamic request variant {:02} item {item_number:04} rendered at ",
        variant_index + 1
    )?;
    description.push_str(request_timestamp);
    description.push('.');
    Ok(())
}

fn string_field_mut<'a>(object: &'a mut Map<String, Value>, key: &str) -> Result<&'a mut String> {
    object
        .get_mut(key)
        .and_then(|value| match value {
            Value::String(value) => Some(value),
            _ => None,
        })
        .with_context(|| format!("Prepared todo field '{key}' must be a string"))
}

fn string_field_mut_or_insert<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut String> {
    if !object.contains_key(key) {
        object.insert(key.to_owned(), Value::String(String::new()));
    }
    string_field_mut(object, key)
}

fn response_sizes(
    handler: &WebUIHandler,
    protocol: &Protocol,
    states: &[Value],
) -> Result<(Vec<usize>, usize)> {
    let mut lengths = Vec::with_capacity(states.len());
    let mut capacity = INITIAL_CAPACITY;
    for state in states {
        let request_state = materialize_request_state(state, PROFILE_TIMESTAMP)?;
        let output = render_html(handler, protocol, &request_state, capacity, None)?;
        capacity = capacity.max(output.len());
        lengths.push(output.len());
    }
    Ok((lengths, capacity))
}

fn create_handler(plugin: HydrationPlugin) -> WebUIHandler {
    match plugin {
        HydrationPlugin::WebUi => {
            WebUIHandler::with_plugin(|| Box::new(WebUIHydrationPlugin::new()))
        }
        HydrationPlugin::FastV3 => {
            WebUIHandler::with_plugin(|| Box::new(FastV3HydrationPlugin::new()))
        }
    }
}

fn load_app_state(config: &ServerConfig) -> Result<(web::Data<AppState>, ReadyMetadata<'static>)> {
    let protocol_bytes = std::fs::read(&config.protocol_path)
        .with_context(|| format!("Failed to read {}", config.protocol_path.display()))?;
    let protocol = Protocol::from_protobuf(&protocol_bytes)
        .with_context(|| format!("Failed to decode {}", config.protocol_path.display()))?;
    let state_bytes = std::fs::read(&config.states_path)
        .with_context(|| format!("Failed to read {}", config.states_path.display()))?;
    let states = parse_states(&state_bytes)?;
    let handler = create_handler(config.plugin);
    let (lengths, dynamic_capacity) = response_sizes(&handler, &protocol, &states.variants)?;
    let cached_timestamp = current_request_timestamp(&AtomicI64::new(0))?;
    let cached_state = materialize_request_state(&states.variants[0], &cached_timestamp)?;
    let cached_body = web::Bytes::from(render_html(
        &handler,
        &protocol,
        &cached_state,
        dynamic_capacity,
        None,
    )?);
    let browser_assets = load_browser_assets()?;
    let metadata = build_metadata(lengths, cached_body.len(), config.plugin.app_id());
    let metadata_body = web::Bytes::from(serde_json::to_vec(&metadata)?);
    let variant_headers = (0..STATE_VARIANT_COUNT)
        .map(|index| HeaderValue::from_str(&index.to_string()))
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_boxed_slice();
    Ok((
        web::Data::new(AppState {
            browser_assets,
            cached_body,
            dynamic_capacity,
            handler,
            metadata_body,
            protocol,
            states: Mutex::new(states),
            last_timestamp_micros: AtomicI64::new(0),
            variant_headers,
            cached_timestamp_header: HeaderValue::from_str(&cached_timestamp)?,
        }),
        metadata,
    ))
}

fn load_browser_assets() -> Result<Option<BrowserAssets>> {
    let Some(directory) = std::env::var_os("WEBUI_BROWSER_ASSET_DIRECTORY") else {
        return Ok(None);
    };
    let directory = std::path::PathBuf::from(directory);
    let bootstrap_path = directory.join("webui.js");
    let components_path = directory.join("webui-components.js");
    let bootstrap = std::fs::read(&bootstrap_path)
        .with_context(|| format!("Failed to read {}", bootstrap_path.display()))?;
    let components = std::fs::read(&components_path)
        .with_context(|| format!("Failed to read {}", components_path.display()))?;
    let styles = load_browser_styles(&directory)?;
    Ok(Some(BrowserAssets {
        bootstrap: web::Bytes::from(bootstrap),
        components: web::Bytes::from(components),
        body_inject: r#"<script type="module" src="/__browser/webui.js"></script>"#.to_owned(),
        styles,
    }))
}

fn load_browser_styles(directory: &Path) -> Result<HashMap<String, web::Bytes>> {
    let mut styles = HashMap::new();
    let mut pending = vec![directory.to_path_buf()];
    while let Some(current) = pending.pop() {
        for entry in std::fs::read_dir(&current)
            .with_context(|| format!("Failed to read {}", current.display()))?
        {
            let entry = entry.context("Failed to read browser asset entry")?;
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("css") {
                continue;
            }
            let relative = path
                .strip_prefix(directory)
                .context("Browser style is outside its asset directory")?
                .to_str()
                .context("Browser style path must be valid UTF-8")?
                .replace('\\', "/");
            let mut request_path = String::with_capacity("/__browser/".len() + relative.len());
            request_path.push_str("/__browser/");
            request_path.push_str(&relative);
            let content = std::fs::read(&path)
                .with_context(|| format!("Failed to read {}", path.display()))?;
            styles.insert(request_path, web::Bytes::from(content));
        }
    }
    Ok(styles)
}

fn parse_states(bytes: &[u8]) -> Result<StatePool> {
    let variants: Vec<Value> =
        serde_json::from_slice(bytes).context("Failed to decode serialized state pool")?;
    StatePool::new(variants)
}

fn html_response(
    body: web::Bytes,
    cache_control: &'static str,
    cache_mode: &'static str,
    variant: HeaderValue,
    request_timestamp: HeaderValue,
) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, HTML_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, cache_control))
        .insert_header(("x-webui-bench-cache", cache_mode))
        .insert_header(("x-webui-bench-timestamp", request_timestamp))
        .insert_header(("x-webui-bench-variant", variant))
        .body(body)
}

fn dynamic_response(
    body: web::Bytes,
    variant: HeaderValue,
    request_timestamp: HeaderValue,
    server_timing: Option<HeaderValue>,
    source_bytes: Option<usize>,
) -> HttpResponse {
    let mut response = html_response(
        body,
        DYNAMIC_CACHE_CONTROL,
        "dynamic",
        variant,
        request_timestamp,
    );
    if let Some(value) = server_timing {
        response
            .headers_mut()
            .insert(HeaderName::from_static("server-timing"), value);
    }
    if let Some(value) = source_bytes {
        match HeaderValue::from_str(&value.to_string()) {
            Ok(value) => {
                response.headers_mut().insert(
                    HeaderName::from_static("x-webui-browser-source-bytes"),
                    value,
                );
            }
            Err(error) => {
                return HttpResponse::InternalServerError()
                    .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                    .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                    .json(ErrorBody {
                        code: "source-byte-header-failed",
                        message: error.to_string(),
                    });
            }
        }
    }
    response
}

fn timing_header(
    state_milliseconds: f64,
    render_milliseconds: f64,
    total_milliseconds: f64,
) -> Result<HeaderValue> {
    let mut value = String::with_capacity(96);
    write!(&mut value, "webui-state;dur={state_milliseconds:.3}")
        .context("Failed to format state timing")?;
    write!(&mut value, ",webui-render;dur={render_milliseconds:.3}")
        .context("Failed to format render timing")?;
    write!(&mut value, ",webui-total;dur={total_milliseconds:.3}")
        .context("Failed to format total timing")?;
    HeaderValue::from_str(&value).context("Failed to encode server timing header")
}

async fn dynamic(request: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    let profile = request.headers().contains_key("x-webui-browser-profile");
    let started = profile.then(Instant::now);
    let request_timestamp = match current_request_timestamp(&state.last_timestamp_micros) {
        Ok(timestamp) => timestamp,
        Err(error) => {
            return HttpResponse::InternalServerError()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .json(ErrorBody {
                    code: "timestamp-failed",
                    message: error.to_string(),
                });
        }
    };
    let mut states = match state.states.lock() {
        Ok(states) => states,
        Err(error) => {
            return HttpResponse::InternalServerError()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .json(ErrorBody {
                    code: "state-pool-unavailable",
                    message: error.to_string(),
                });
        }
    };
    let (index, request_state) = states.next_mut();
    if let Err(error) = rewrite_request_state(request_state, &request_timestamp) {
        return HttpResponse::InternalServerError()
            .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
            .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
            .json(ErrorBody {
                code: "state-materialization-failed",
                message: error.to_string(),
            });
    }
    let render_started = profile.then(Instant::now);
    let body_inject = if profile {
        state
            .browser_assets
            .as_ref()
            .map(|assets| assets.body_inject.as_str())
    } else {
        None
    };
    match render_html(
        &state.handler,
        &state.protocol,
        request_state,
        state.dynamic_capacity,
        body_inject,
    ) {
        Ok(output) => {
            let source_bytes =
                body_inject.map(|content| output.len().saturating_sub(content.len()));
            let server_timing = match (started, render_started) {
                (Some(started), Some(render_started)) => {
                    match timing_header(
                        render_started.duration_since(started).as_secs_f64() * 1_000.0,
                        render_started.elapsed().as_secs_f64() * 1_000.0,
                        started.elapsed().as_secs_f64() * 1_000.0,
                    ) {
                        Ok(value) => Some(value),
                        Err(error) => {
                            return HttpResponse::InternalServerError()
                                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                                .json(ErrorBody {
                                    code: "timing-header-failed",
                                    message: error.to_string(),
                                });
                        }
                    }
                }
                _ => None,
            };
            dynamic_response(
                web::Bytes::from(output),
                state.variant_headers[index].clone(),
                match HeaderValue::from_str(&request_timestamp) {
                    Ok(header) => header,
                    Err(error) => {
                        return HttpResponse::InternalServerError()
                            .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                            .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                            .json(ErrorBody {
                                code: "timestamp-header-failed",
                                message: error.to_string(),
                            });
                    }
                },
                server_timing,
                source_bytes,
            )
        }
        Err(error) => HttpResponse::InternalServerError()
            .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
            .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
            .json(ErrorBody {
                code: "render-failed",
                message: error.to_string(),
            }),
    }
}

async fn cached(state: web::Data<AppState>) -> HttpResponse {
    html_response(
        state.cached_body.clone(),
        CACHED_CACHE_CONTROL,
        "cached",
        HeaderValue::from_static("0"),
        state.cached_timestamp_header.clone(),
    )
}

fn browser_asset_response(body: Option<&web::Bytes>, content_type: &'static str) -> HttpResponse {
    match body {
        Some(body) => HttpResponse::Ok()
            .insert_header((CONTENT_TYPE, content_type))
            .insert_header((CACHE_CONTROL, "public, max-age=31536000, immutable"))
            .body(body.clone()),
        None => HttpResponse::NotFound()
            .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
            .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
            .json(ErrorBody {
                code: "browser-assets-unavailable",
                message: "Launch with WEBUI_BROWSER_ASSET_DIRECTORY".to_owned(),
            }),
    }
}

async fn browser_bootstrap(state: web::Data<AppState>) -> HttpResponse {
    browser_asset_response(
        state
            .browser_assets
            .as_ref()
            .map(|assets| &assets.bootstrap),
        "text/javascript; charset=utf-8",
    )
}

async fn browser_components(state: web::Data<AppState>) -> HttpResponse {
    browser_asset_response(
        state
            .browser_assets
            .as_ref()
            .map(|assets| &assets.components),
        "text/javascript; charset=utf-8",
    )
}

async fn browser_style(request: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    browser_asset_response(
        state
            .browser_assets
            .as_ref()
            .and_then(|assets| assets.styles.get(request.path())),
        "text/css; charset=utf-8",
    )
}

async fn ready(state: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
        .body(state.metadata_body.clone())
}

async fn favicon() -> HttpResponse {
    HttpResponse::NoContent()
        .insert_header((CACHE_CONTROL, "public, max-age=86400"))
        .finish()
}

async fn not_found() -> HttpResponse {
    HttpResponse::NotFound()
        .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
        .json(ErrorBody {
            code: "route-not-found",
            message: "Use /dynamic, /cached, or /__bench/ready.".to_owned(),
        })
}

/// Run the Actix server with exactly one worker.
pub async fn run(config: ServerConfig) -> Result<()> {
    let (state, metadata) = load_app_state(&config)?;
    let host = config.host;
    let server = HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .route("/dynamic", web::get().to(dynamic))
            .route("/cached", web::get().to(cached))
            .route("/__browser/webui.js", web::get().to(browser_bootstrap))
            .route(
                "/__browser/webui-components.js",
                web::get().to(browser_components),
            )
            .route("/__browser/{asset:.*}", web::get().to(browser_style))
            .route("/__bench/ready", web::get().to(ready))
            .route("/ready", web::get().to(ready))
            .route("/favicon.ico", web::get().to(favicon))
            .default_service(web::to(not_found))
    })
    .workers(1);
    let server = if config.tls {
        server
            .bind_rustls_0_23((host.as_str(), config.port), local_http2_tls_config()?)
            .with_context(|| format!("Failed to bind HTTP/2 {}:{}", host, config.port))?
    } else {
        server
            .bind((host.as_str(), config.port))
            .with_context(|| format!("Failed to bind {}:{}", host, config.port))?
    };
    let port = server
        .addrs()
        .first()
        .context("Actix did not expose a TCP benchmark address")?
        .port();
    let announcement = Announcement {
        metadata: &metadata,
        host: &host,
        port,
        url: format!(
            "{}://{host}:{port}",
            if config.tls { "https" } else { "http" },
        ),
    };
    println!("{}", serde_json::to_string(&announcement)?);
    server.run().await.context("Actix benchmark server failed")
}

#[cfg(test)]
mod tests {
    use super::{
        current_request_timestamp, html_response, load_browser_styles, materialize_request_state,
        parse_states, rewrite_request_state, timing_header, CACHED_CACHE_CONTROL,
        DYNAMIC_CACHE_CONTROL, HTML_CONTENT_TYPE, STATE_VARIANT_COUNT,
    };
    use actix_web::body::MessageBody;
    use actix_web::http::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
    use actix_web::web;
    use serde::Serialize;
    use serde_json::json;
    use std::sync::atomic::AtomicI64;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TestState {
        variant_index: usize,
    }

    fn serialized_states(count: usize) -> Vec<u8> {
        serde_json::to_vec(
            &(0..count)
                .map(|variant_index| TestState { variant_index })
                .collect::<Vec<_>>(),
        )
        .unwrap_or_default()
    }

    #[test]
    fn browser_timing_header_exposes_state_render_and_total_phases() {
        let header = timing_header(0.125, 0.75, 0.9)
            .unwrap_or_else(|error| panic!("timing header should encode: {error}"));
        assert_eq!(
            header,
            "webui-state;dur=0.125,webui-render;dur=0.750,webui-total;dur=0.900"
        );
    }

    #[test]
    fn browser_styles_preserve_light_and_shadow_asset_paths() {
        let root =
            std::env::temp_dir().join(format!("webui-todo-browser-styles-{}", std::process::id()));
        let light = root.join("light");
        let shadow = root.join("shadow");
        std::fs::create_dir_all(&light)
            .unwrap_or_else(|error| panic!("light style directory should exist: {error}"));
        std::fs::create_dir_all(&shadow)
            .unwrap_or_else(|error| panic!("shadow style directory should exist: {error}"));
        std::fs::write(light.join("todo-app.css"), b"main{}")
            .unwrap_or_else(|error| panic!("light style should write: {error}"));
        std::fs::write(shadow.join("todo-app.css"), b":host{}")
            .unwrap_or_else(|error| panic!("shadow style should write: {error}"));
        std::fs::write(root.join("ignored.js"), b"export{}")
            .unwrap_or_else(|error| panic!("non-style asset should write: {error}"));

        let styles = load_browser_styles(&root)
            .unwrap_or_else(|error| panic!("browser styles should load: {error}"));
        assert_eq!(styles.len(), 2);
        assert_eq!(
            styles.get("/__browser/light/todo-app.css"),
            Some(&web::Bytes::from_static(b"main{}"))
        );
        assert_eq!(
            styles.get("/__browser/shadow/todo-app.css"),
            Some(&web::Bytes::from_static(b":host{}"))
        );
        std::fs::remove_dir_all(root)
            .unwrap_or_else(|error| panic!("browser style fixture should clean up: {error}"));
    }

    #[test]
    fn state_pool_rotates_all_variants() {
        let result = parse_states(&serialized_states(STATE_VARIANT_COUNT));
        let Ok(mut states) = result else {
            panic!("valid state pool should parse");
        };
        for expected in 0..STATE_VARIANT_COUNT {
            let (index, value) = states.next_mut();
            assert_eq!(index, expected);
            assert_eq!(value["variantIndex"], expected);
        }
        assert_eq!(states.next_mut().0, 0);
    }

    #[test]
    fn state_pool_rejects_wrong_variant_count() {
        let result = parse_states(&serialized_states(STATE_VARIANT_COUNT - 1));
        assert!(result.is_err());
        assert!(result
            .err()
            .is_some_and(|error| error.to_string().contains("exactly 32")));
    }

    #[test]
    fn state_pool_rejects_wrong_variant_order() {
        let mut states = serialized_states(STATE_VARIANT_COUNT);
        let marker = b"\"variantIndex\":1";
        let Some(offset) = states
            .windows(marker.len())
            .position(|window| window == marker)
        else {
            panic!("serialized fixture should contain the second variant");
        };
        states[offset + marker.len() - 1] = b'9';
        let result = parse_states(&states);
        assert!(result.is_err());
        assert!(result
            .err()
            .is_some_and(|error| error.to_string().contains("variant 1")));
    }

    #[test]
    fn html_responses_have_equivalent_explicit_headers() {
        let timestamp = HeaderValue::from_static("2026-08-22T00:00:00.000000Z");
        let response = html_response(
            web::Bytes::from_static(b"<p>ok</p>"),
            DYNAMIC_CACHE_CONTROL,
            "dynamic",
            HeaderValue::from_static("7"),
            timestamp.clone(),
        );
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static(HTML_CONTENT_TYPE))
        );
        assert_eq!(
            response.headers().get(CACHE_CONTROL),
            Some(&HeaderValue::from_static(DYNAMIC_CACHE_CONTROL))
        );
        assert!(response.headers().get("content-encoding").is_none());

        let cached = html_response(
            web::Bytes::from_static(b"<p>ok</p>"),
            CACHED_CACHE_CONTROL,
            "cached",
            HeaderValue::from_static("0"),
            timestamp,
        );
        assert_eq!(
            cached.headers().get(CACHE_CONTROL),
            Some(&HeaderValue::from_static(CACHED_CACHE_CONTROL))
        );
        assert_eq!(cached.body().size(), actix_web::body::BodySize::Sized(9));
    }

    #[test]
    fn request_state_uses_one_current_timestamp_for_every_todo() {
        let base = json!({
            "variantIndex": 2,
            "todos": [
                {"title": "old", "timestamp": "old", "description": "old"},
                {"title": "old", "timestamp": "old", "description": "old"}
            ],
            "footer": {}
        });
        let timestamp = "2026-08-22T00:00:00.123456Z";
        let mut state = materialize_request_state(&base, timestamp)
            .unwrap_or_else(|error| panic!("request state should materialize: {error}"));
        assert_eq!(state["requestTimestamp"], timestamp);
        assert_eq!(
            state["todos"][0]["title"],
            format!("Todo 0001 · {timestamp}")
        );
        assert_eq!(state["todos"][1]["timestamp"], timestamp);
        assert!(state["todos"][1]["description"]
            .as_str()
            .is_some_and(|value| value.contains(timestamp)));
        let second_timestamp = "2026-08-22T00:00:00.654321Z";
        rewrite_request_state(&mut state, second_timestamp)
            .unwrap_or_else(|error| panic!("request state should be reusable: {error}"));
        assert_eq!(state["requestTimestamp"], second_timestamp);
        assert_eq!(
            state["todos"][0]["title"],
            format!("Todo 0001 · {second_timestamp}")
        );
        assert_eq!(
            state["footer"]["requestTimestampLabel"],
            format!("Rendered {second_timestamp}")
        );
        assert!(!state.to_string().contains(timestamp));
    }

    #[test]
    fn request_timestamps_are_monotonic_and_unique() {
        let last = AtomicI64::new(0);
        let first = current_request_timestamp(&last)
            .unwrap_or_else(|error| panic!("first timestamp should format: {error}"));
        let second = current_request_timestamp(&last)
            .unwrap_or_else(|error| panic!("second timestamp should format: {error}"));
        assert_eq!(first.len(), 27);
        assert_eq!(second.len(), 27);
        assert_eq!(first.as_bytes()[19], b'.');
        assert!(first.ends_with('Z'));
        assert!(second > first);
    }
}
