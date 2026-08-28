// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

mod config;
mod metadata;

use actix_web::http::header::{HeaderName, HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use anyhow::{Context, Result};
use config::HydrationPlugin;
use futures_core::Stream;
use metadata::{build_metadata, Announcement, ReadyMetadata};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io;
use std::mem;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context as TaskContext, Poll};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use time::format_description::BorrowedFormatItem;
use time::macros::format_description;
use time::OffsetDateTime;
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::SendTimeoutError;
use webui_handler::plugin::fast_v3::FastV3HydrationPlugin;
use webui_handler::plugin::webui::WebUIHydrationPlugin;
use webui_handler::{FlushWriter, Protocol, RenderOptions, ResponseWriter, WebUIHandler};

pub use config::ServerConfig;

const STATE_VARIANT_COUNT: usize = 32;
const ENTRY_ID: &str = "index.html";
const DYNAMIC_PATH: &str = "/dynamic";
const CACHED_PATH: &str = "/cached";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const DYNAMIC_CACHE_CONTROL: &str = "no-store";
const CACHED_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";
const SERVER_SCHEMA: &str = "webui.ssr-todo-server/v1";
const INITIAL_CAPACITY: usize = 64 * 1024;
const PROFILE_TIMESTAMP: &str = "2000-01-01T00:00:00.000000Z";
const REQUEST_TIMESTAMP_FORMAT: &[BorrowedFormatItem<'static>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:6]Z");
const STREAM_CHUNK_SIZE: usize = 16 * 1024;
const STREAM_FLUSH_TIMEOUT: Duration = Duration::from_secs(5);
const STREAM_RENDER_QUEUE_CAPACITY: usize = 128;

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

impl FlushWriter for MemoryWriter {
    fn flush(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

type StreamChunk = std::result::Result<web::Bytes, io::Error>;

struct ChannelWriter {
    buffer: String,
    flush_threshold: Option<usize>,
    runtime: tokio::runtime::Handle,
    sender: mpsc::Sender<StreamChunk>,
}

impl ChannelWriter {
    fn new(
        sender: mpsc::Sender<StreamChunk>,
        flush_threshold: Option<usize>,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self {
            buffer: String::with_capacity(INITIAL_CAPACITY),
            flush_threshold,
            runtime,
            sender,
        }
    }
}

impl ResponseWriter for ChannelWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        if self.sender.is_closed() {
            return Err(webui_handler::HandlerError::ClientDisconnected);
        }
        self.buffer.push_str(content);
        if self
            .flush_threshold
            .is_some_and(|threshold| self.buffer.len() >= threshold)
        {
            self.flush()
        } else {
            Ok(())
        }
    }

    fn end(&mut self) -> webui_handler::Result<()> {
        self.flush()
    }
}

impl FlushWriter for ChannelWriter {
    fn flush(&mut self) -> webui_handler::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        let bytes = web::Bytes::from(mem::take(&mut self.buffer));
        match self
            .runtime
            .block_on(self.sender.send_timeout(Ok(bytes), STREAM_FLUSH_TIMEOUT))
        {
            Ok(()) => Ok(()),
            Err(SendTimeoutError::Closed(_)) => {
                Err(webui_handler::HandlerError::ClientDisconnected)
            }
            Err(SendTimeoutError::Timeout(_)) => Err(webui_handler::HandlerError::StreamTimeout),
        }
    }
}

struct ChannelStream {
    error: Arc<Mutex<Option<io::Error>>>,
    receiver: mpsc::Receiver<StreamChunk>,
    reported_error: bool,
}

impl Stream for ChannelStream {
    type Item = StreamChunk;

    fn poll_next(
        mut self: Pin<&mut Self>,
        context: &mut TaskContext<'_>,
    ) -> Poll<Option<Self::Item>> {
        match self.receiver.poll_recv(context) {
            Poll::Ready(None) if !self.reported_error => {
                self.reported_error = true;
                let error = self.error.lock().ok().and_then(|mut error| error.take());
                Poll::Ready(error.map(Err))
            }

            result => result,
        }
    }
}

struct RenderJob {
    error: Arc<Mutex<Option<io::Error>>>,
    render_state: Value,
    request_path: String,
    sender: mpsc::Sender<StreamChunk>,
}

struct RenderWorker {
    sender: Option<mpsc::Sender<RenderJob>>,
    thread: Option<JoinHandle<()>>,
}

impl RenderWorker {
    fn new(
        handler: Arc<WebUIHandler>,
        protocol: Arc<Protocol>,
        progressive_boundaries: bool,
    ) -> Result<Self> {
        let (sender, mut receiver) = mpsc::channel::<RenderJob>(STREAM_RENDER_QUEUE_CAPACITY);
        let runtime = tokio::runtime::Handle::current();
        let thread = thread::Builder::new()
            .name("webui-stream-render".to_owned())
            .spawn(move || {
                while let Some(job) = receiver.blocking_recv() {
                    if job.sender.is_closed() {
                        continue;
                    }
                    let mut writer = ChannelWriter::new(
                        job.sender,
                        (!progressive_boundaries).then_some(STREAM_CHUNK_SIZE),
                        runtime.clone(),
                    );
                    let options = RenderOptions::new(ENTRY_ID, &job.request_path);
                    let result = if progressive_boundaries {
                        drive_streaming_response(
                            &handler,
                            &protocol,
                            &job.render_state,
                            &options,
                            &mut writer,
                        )
                    } else {
                        handler.render(&protocol, &job.render_state, &options, &mut writer)
                    };
                    if let Err(error) = result {
                        if let Ok(mut render_error) = job.error.lock() {
                            *render_error = Some(io::Error::other(error));
                        }
                    }
                }
            })
            .context("Failed to start WebUI streaming render worker")?;
        Ok(Self {
            sender: Some(sender),
            thread: Some(thread),
        })
    }

    fn stream(&self, render_state: Value, request_path: String) -> Result<ChannelStream> {
        let (sender, receiver) = mpsc::channel(1);
        let error = Arc::new(Mutex::new(None));
        self.sender
            .as_ref()
            .context("WebUI streaming render worker is closed")?
            .try_send(RenderJob {
                error: Arc::clone(&error),
                render_state,
                request_path,
                sender,
            })
            .context("WebUI streaming render queue is full or closed")?;
        Ok(ChannelStream {
            error,
            receiver,
            reported_error: false,
        })
    }
}

impl Drop for RenderWorker {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
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
    fast_routes: bool,
    metadata_body: web::Bytes,
    protocol: Arc<Protocol>,
    render_worker: RenderWorker,
    states: Mutex<StatePool>,
    last_timestamp_micros: AtomicI64,
    variant_headers: Box<[HeaderValue]>,
    cached_timestamp_header: HeaderValue,
}

struct BrowserAssets {
    bootstrap: web::Bytes,
    styles: HashMap<String, web::Bytes>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

fn drive_streaming_response<W: FlushWriter + ?Sized>(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    options: &RenderOptions<'_>,
    writer: &mut W,
) -> webui_handler::Result<()> {
    handler.render_streaming(protocol, state, options, writer)
}

fn render_html(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    capacity: usize,
    request_path: &str,
) -> Result<String> {
    let mut writer = MemoryWriter::with_capacity(capacity);
    let options = RenderOptions::new(ENTRY_ID, request_path);
    handler
        .render(protocol, state, &options, &mut writer)
        .context("WebUI render failed")?;
    Ok(writer.output)
}

fn render_streaming_html(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    capacity: usize,
    request_path: &str,
) -> Result<String> {
    let mut writer = MemoryWriter::with_capacity(capacity);
    let options = RenderOptions::new(ENTRY_ID, request_path);
    drive_streaming_response(handler, protocol, state, &options, &mut writer)
        .context("WebUI streaming render failed")?;
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

const WEBUI_TODO_FIELDS: &[&str] = &[
    "assigned",
    "assigneeLabel",
    "blocked",
    "blockedLabel",
    "completed",
    "description",
    "dueLabel",
    "dueToday",
    "hasSubtasks",
    "hasTags",
    "id",
    "isHighPriority",
    "isMediumPriority",
    "overdue",
    "pending",
    "priority",
    "priorityLabel",
    "recurring",
    "recurringLabel",
    "selected",
    "selectionLabel",
    "statusLabel",
    "subtaskCountLabel",
    "subtaskProgressLabel",
    "tagCountLabel",
    "tags",
    "title",
    "visible",
];

fn webui_render_state(state: &Value) -> Result<Value> {
    let mut state = state.clone();
    let root = state
        .as_object_mut()
        .context("Prepared WebUI state must be an object")?;
    let todos = root
        .get("todos")
        .and_then(Value::as_array)
        .context("Prepared WebUI state must contain todos")?;
    let projected_todos = todos
        .iter()
        .map(|todo| {
            let todo = todo
                .as_object()
                .context("Every WebUI todo must be an object")?;
            WEBUI_TODO_FIELDS
                .iter()
                .map(|field| {
                    todo.get(*field)
                        .cloned()
                        .map(|value| ((*field).to_owned(), value))
                        .with_context(|| format!("WebUI todo is missing {field}"))
                })
                .collect::<Result<Map<String, Value>>>()
                .map(Value::Object)
        })
        .collect::<Result<Vec<_>>>()?;
    root.insert("todos".to_owned(), Value::Array(projected_todos));
    let intelligence = root
        .get_mut("intelligence")
        .and_then(Value::as_object_mut)
        .context("Prepared WebUI state must contain workspace intelligence")?;
    intelligence.remove("analytics");
    intelligence.remove("boardColumns");
    Ok(state)
}

fn fast_route_state(state: &Value, request_path: &str) -> Result<Option<Value>> {
    let key = match request_path {
        "/activity" => "activity",
        "/settings" => "settings",
        _ => return Ok(None),
    };
    state
        .get(key)
        .cloned()
        .map(Some)
        .with_context(|| format!("Prepared state is missing {key}"))
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
    rewrite_workspace_titles(root, request_timestamp)?;
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

fn rewrite_workspace_titles(root: &mut Map<String, Value>, request_timestamp: &str) -> Result<()> {
    let intelligence = root
        .get_mut("intelligence")
        .and_then(Value::as_object_mut)
        .context("Prepared request state must contain workspace intelligence")?;
    let preview_rows = intelligence
        .get_mut("previewRows")
        .and_then(Value::as_array_mut)
        .context("Workspace intelligence must contain previewRows")?;
    for row in preview_rows {
        rewrite_workspace_row_title(row, request_timestamp)?;
    }
    let board_columns = intelligence
        .get_mut("boardColumns")
        .and_then(Value::as_array_mut)
        .context("Workspace intelligence must contain boardColumns")?;
    for column in board_columns {
        let items = column
            .get_mut("items")
            .and_then(Value::as_array_mut)
            .context("Every workspace board column must contain items")?;
        for row in items {
            rewrite_workspace_row_title(row, request_timestamp)?;
        }
    }
    Ok(())
}

fn rewrite_workspace_row_title(row: &mut Value, request_timestamp: &str) -> Result<()> {
    let row = row
        .as_object_mut()
        .context("Every workspace row must be an object")?;
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .context("Every workspace row must contain an id")?;
    let item_number = id
        .strip_prefix("todo-")
        .filter(|value| value.len() == 4 && value.bytes().all(|byte| byte.is_ascii_digit()))
        .context("Workspace row ids must use the todo-0000 format")?
        .to_owned();
    let title = string_field_mut(row, "title")?;
    title.clear();
    write!(title, "Todo {item_number} · ")?;
    title.push_str(request_timestamp);
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
    project_webui: bool,
) -> Result<(Vec<usize>, usize)> {
    let mut lengths = Vec::with_capacity(states.len());
    let mut capacity = INITIAL_CAPACITY;
    for state in states {
        let request_state = materialize_request_state(state, PROFILE_TIMESTAMP)?;
        let request_state = if project_webui {
            webui_render_state(&request_state)?
        } else {
            request_state
        };
        let output = if project_webui {
            render_streaming_html(handler, protocol, &request_state, capacity, DYNAMIC_PATH)?
        } else {
            render_html(handler, protocol, &request_state, capacity, DYNAMIC_PATH)?
        };
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
    let protocol = Arc::new(
        Protocol::from_protobuf(&protocol_bytes)
            .with_context(|| format!("Failed to decode {}", config.protocol_path.display()))?,
    );
    let state_bytes = std::fs::read(&config.states_path)
        .with_context(|| format!("Failed to read {}", config.states_path.display()))?;
    let states = parse_states(&state_bytes)?;
    let handler = Arc::new(create_handler(config.plugin));
    let project_webui = config.plugin == HydrationPlugin::WebUi;
    let (lengths, dynamic_capacity) =
        response_sizes(&handler, &protocol, &states.variants, project_webui)?;
    let cached_timestamp = current_request_timestamp(&AtomicI64::new(0))?;
    let cached_state = materialize_request_state(&states.variants[0], &cached_timestamp)?;
    let cached_state = if project_webui {
        webui_render_state(&cached_state)?
    } else {
        cached_state
    };
    let cached_body = web::Bytes::from(if project_webui {
        render_streaming_html(
            &handler,
            &protocol,
            &cached_state,
            dynamic_capacity,
            CACHED_PATH,
        )?
    } else {
        render_html(
            &handler,
            &protocol,
            &cached_state,
            dynamic_capacity,
            CACHED_PATH,
        )?
    });
    let browser_assets = load_browser_assets()?;
    let metadata = build_metadata(lengths, cached_body.len(), config.plugin.app_id());
    let metadata_body = web::Bytes::from(serde_json::to_vec(&metadata)?);
    let render_worker =
        RenderWorker::new(Arc::clone(&handler), Arc::clone(&protocol), project_webui)?;
    let variant_headers = (0..STATE_VARIANT_COUNT)
        .map(|index| HeaderValue::from_str(&index.to_string()))
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_boxed_slice();
    Ok((
        web::Data::new(AppState {
            browser_assets,
            cached_body,
            fast_routes: config.plugin == HydrationPlugin::FastV3,
            metadata_body,
            protocol,
            render_worker,
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
    let bootstrap = std::fs::read(&bootstrap_path)
        .with_context(|| format!("Failed to read {}", bootstrap_path.display()))?;
    let styles = load_browser_route_assets(&directory)?;
    Ok(Some(BrowserAssets {
        bootstrap: web::Bytes::from(bootstrap),
        styles,
    }))
}

fn load_browser_route_assets(directory: &Path) -> Result<HashMap<String, web::Bytes>> {
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
            let extension = path.extension().and_then(|value| value.to_str());
            if extension != Some("css") && extension != Some("js") {
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

fn dynamic_stream_response(
    stream: ChannelStream,
    content_type: &'static str,
    variant: HeaderValue,
    request_timestamp: HeaderValue,
    server_timing: Option<HeaderValue>,
) -> HttpResponse {
    let mut response = HttpResponse::Ok();
    response
        .insert_header((CONTENT_TYPE, content_type))
        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
        .insert_header(("x-webui-bench-cache", "dynamic"))
        .insert_header(("x-webui-bench-timestamp", request_timestamp))
        .insert_header(("x-webui-bench-variant", variant));
    if let Some(value) = server_timing {
        response.insert_header((HeaderName::from_static("server-timing"), value));
    }
    response.streaming(stream)
}

fn empty_channel_stream() -> ChannelStream {
    let (sender, receiver) = mpsc::channel(1);
    drop(sender);
    ChannelStream {
        error: Arc::new(Mutex::new(None)),
        receiver,
        reported_error: false,
    }
}

fn stream_timing_header(milliseconds: f64) -> Result<HeaderValue> {
    let mut value = String::with_capacity(32);
    write!(&mut value, "webui-stream-setup;dur={milliseconds:.3}")
        .context("Failed to format stream timing")?;
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
    let request_path = request.path();
    let scoped_state = if state.fast_routes {
        match fast_route_state(request_state, request_path) {
            Ok(value) => value,
            Err(error) => {
                return HttpResponse::InternalServerError()
                    .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                    .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                    .json(ErrorBody {
                        code: "route-state-failed",
                        message: error.to_string(),
                    });
            }
        }
    } else {
        None
    };
    let projected_state = if state.fast_routes {
        None
    } else {
        match webui_render_state(request_state) {
            Ok(value) => Some(value),
            Err(error) => {
                return HttpResponse::InternalServerError()
                    .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                    .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                    .json(ErrorBody {
                        code: "state-projection-failed",
                        message: error.to_string(),
                    });
            }
        }
    };
    let render_state = scoped_state
        .as_ref()
        .or(projected_state.as_ref())
        .unwrap_or(request_state);
    let accepts_partial = request
        .headers()
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.contains("application/json") || value.contains("application/x-ndjson")
        });
    if accepts_partial {
        let inventory = request
            .headers()
            .get("x-webui-inventory")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        let state_json = match serde_json::to_string(render_state) {
            Ok(value) => value,
            Err(error) => {
                return HttpResponse::InternalServerError()
                    .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                    .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                    .json(ErrorBody {
                        code: "state-serialization-failed",
                        message: error.to_string(),
                    });
            }
        };
        return match state
            .protocol
            .render_partial(&state_json, ENTRY_ID, request_path, inventory)
        {
            Ok(output) => HttpResponse::Ok()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .insert_header(("x-webui-bench-timestamp", request_timestamp))
                .insert_header((
                    "x-webui-bench-variant",
                    state.variant_headers[index].clone(),
                ))
                .body(output),
            Err(error) => HttpResponse::InternalServerError()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .json(ErrorBody {
                    code: "partial-render-failed",
                    message: error.to_string(),
                }),
        };
    }
    let render_state = render_state.clone();
    let request_path = request_path.to_owned();
    let variant = state.variant_headers[index].clone();
    drop(states);
    let request_timestamp_header = match HeaderValue::from_str(&request_timestamp) {
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
    };
    let stream = match state.render_worker.stream(render_state, request_path) {
        Ok(stream) => stream,
        Err(error) => {
            return HttpResponse::ServiceUnavailable()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .json(ErrorBody {
                    code: "render-queue-unavailable",
                    message: error.to_string(),
                });
        }
    };
    let server_timing = match started {
        Some(started) => match stream_timing_header(started.elapsed().as_secs_f64() * 1_000.0) {
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
        },
        None => None,
    };
    dynamic_stream_response(
        stream,
        HTML_CONTENT_TYPE,
        variant,
        request_timestamp_header,
        server_timing,
    )
}

async fn dynamic_head(request: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
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
    let index = match state.states.lock() {
        Ok(mut states) => states.next_mut().0,
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
    dynamic_stream_response(
        empty_channel_stream(),
        if request
            .headers()
            .get("accept")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value.contains("application/json") || value.contains("application/x-ndjson")
            })
        {
            JSON_CONTENT_TYPE
        } else {
            HTML_CONTENT_TYPE
        },
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
        None,
    )
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

async fn cached_head(state: web::Data<AppState>) -> HttpResponse {
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

async fn browser_style(request: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    let content_type = if request.path().ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else {
        "text/css; charset=utf-8"
    };
    browser_asset_response(
        state
            .browser_assets
            .as_ref()
            .and_then(|assets| assets.styles.get(request.path())),
        content_type,
    )
}

async fn ready(state: web::Data<AppState>) -> HttpResponse {
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
        .body(state.metadata_body.clone())
}

async fn route_state(state: web::Data<AppState>) -> HttpResponse {
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
    let work_state = if state.fast_routes {
        request_state.clone()
    } else {
        match webui_render_state(request_state) {
            Ok(value) => value,
            Err(error) => {
                return HttpResponse::InternalServerError()
                    .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                    .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                    .json(ErrorBody {
                        code: "state-projection-failed",
                        message: error.to_string(),
                    });
            }
        }
    };
    HttpResponse::Ok()
        .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
        .insert_header(("x-webui-bench-timestamp", request_timestamp))
        .insert_header((
            "x-webui-bench-variant",
            state.variant_headers[index].clone(),
        ))
        .json(serde_json::json!({
            "activity": request_state.get("activity"),
            "settings": request_state.get("settings"),
            "work": work_state,
        }))
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
            message: "Use /dynamic, /activity, /settings, /cached, or /__bench/ready.".to_owned(),
        })
}

/// Run the Actix server with exactly one worker.
pub async fn run(config: ServerConfig) -> Result<()> {
    let (state, metadata) = load_app_state(&config)?;
    let host = config.host;
    let server = HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .service(
                web::resource("/dynamic")
                    .route(web::head().to(dynamic_head))
                    .route(web::get().to(dynamic)),
            )
            .service(
                web::resource("/activity")
                    .route(web::head().to(dynamic_head))
                    .route(web::get().to(dynamic)),
            )
            .service(
                web::resource("/settings")
                    .route(web::head().to(dynamic_head))
                    .route(web::get().to(dynamic)),
            )
            .service(
                web::resource("/cached")
                    .route(web::head().to(cached_head))
                    .route(web::get().to(cached)),
            )
            .route("/__browser/webui.js", web::get().to(browser_bootstrap))
            .route("/__browser/{asset:.*}", web::get().to(browser_style))
            .route("/__bench/ready", web::get().to(ready))
            .route("/__bench/route-state", web::get().to(route_state))
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
        current_request_timestamp, html_response, load_browser_route_assets,
        materialize_request_state, parse_states, rewrite_request_state, stream_timing_header,
        webui_render_state, CACHED_CACHE_CONTROL, DYNAMIC_CACHE_CONTROL, HTML_CONTENT_TYPE,
        STATE_VARIANT_COUNT, WEBUI_TODO_FIELDS,
    };
    use actix_web::body::MessageBody;
    use actix_web::http::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
    use actix_web::web;
    use serde::Serialize;
    use serde_json::{json, Map, Value};
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
    fn browser_timing_header_exposes_stream_start() {
        let header = stream_timing_header(0.125)
            .unwrap_or_else(|error| panic!("timing header should encode: {error}"));
        assert_eq!(header, "webui-stream-setup;dur=0.125");
    }

    #[test]
    fn browser_assets_preserve_style_and_script_paths() {
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
        std::fs::write(root.join("route.js"), b"export{}")
            .unwrap_or_else(|error| panic!("route script should write: {error}"));

        let styles = load_browser_route_assets(&root)
            .unwrap_or_else(|error| panic!("browser assets should load: {error}"));
        assert_eq!(styles.len(), 3);
        assert_eq!(
            styles.get("/__browser/light/todo-app.css"),
            Some(&web::Bytes::from_static(b"main{}"))
        );
        assert_eq!(
            styles.get("/__browser/shadow/todo-app.css"),
            Some(&web::Bytes::from_static(b":host{}"))
        );
        assert_eq!(
            styles.get("/__browser/route.js"),
            Some(&web::Bytes::from_static(b"export{}"))
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
    fn webui_state_keeps_only_rendered_interactive_todo_fields() {
        let todo = WEBUI_TODO_FIELDS
            .iter()
            .map(|field| ((*field).to_owned(), json!(field)))
            .chain([
                ("assignee".to_owned(), json!({ "name": "Ada" })),
                ("subtasks".to_owned(), json!([{ "id": "subtask-1" }])),
                ("timestamp".to_owned(), json!("2026-08-27T00:00:00.000Z")),
            ])
            .collect::<Map<String, Value>>();
        let state = json!({
            "intelligence": {
                "analytics": { "average": 1 },
                "boardColumns": [],
                "previewRows": []
            },
            "todos": [Value::Object(todo)]
        });
        let projected = webui_render_state(&state)
            .unwrap_or_else(|error| panic!("WebUI state should project: {error}"));
        let todo = projected["todos"][0]
            .as_object()
            .unwrap_or_else(|| panic!("projected todo should be an object"));
        assert_eq!(todo.len(), WEBUI_TODO_FIELDS.len());
        assert!(!todo.contains_key("assignee"));
        assert!(!todo.contains_key("subtasks"));
        assert!(!todo.contains_key("timestamp"));
        assert!(projected["intelligence"].get("analytics").is_none());
        assert!(projected["intelligence"].get("boardColumns").is_none());
        assert!(projected["intelligence"].get("previewRows").is_some());
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
            "intelligence": {
                "previewRows": [
                    {"id": "todo-0001", "title": "old"},
                    {"id": "todo-0002", "title": "old"}
                ],
                "boardColumns": [
                    {"items": [{"id": "todo-0001", "title": "old"}]}
                ]
            },
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
        assert_eq!(
            state["intelligence"]["previewRows"][0]["title"],
            format!("Todo 0001 · {timestamp}")
        );
        assert_eq!(
            state["intelligence"]["boardColumns"][0]["items"][0]["title"],
            format!("Todo 0001 · {timestamp}")
        );
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
