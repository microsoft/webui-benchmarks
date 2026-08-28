// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

mod config;
mod metadata;

use actix_web::http::header::{HeaderName, HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer};
use anyhow::{Context, Result};
use config::{HydrationPlugin, ResponseMode};
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
use std::sync::atomic::{AtomicI64, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context as TaskContext, Poll};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use time::format_description::BorrowedFormatItem;
use time::macros::format_description;
use time::OffsetDateTime;
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::{SendTimeoutError, TrySendError};
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
const STREAM_RESPONSE_CHANNEL_CAPACITY: usize = 8;
/// Environment variable that enables the streaming pipeline stage trace. Disabled by
/// default so production benchmark runs pay no logging cost; set to `1` to attribute
/// wall-clock time across accept/queue/render/flush/poll/disconnect stages for a run.
const STREAM_TRACE_ENV: &str = "WEBUI_BENCH_TRACE_STREAMING";

fn stream_trace_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var(STREAM_TRACE_ENV).is_ok_and(|value| value == "1"))
}

/// Per-request stage trace used to diagnose streaming pipeline stalls. Cheap to carry
/// (an `Option<Arc<_>>`) and a no-op unless `WEBUI_BENCH_TRACE_STREAMING=1`. Timestamps
/// are relative to a single shared process epoch (not per-request) so that events from
/// different requests can be correlated to detect overlap or serialization.
struct RequestTrace {
    id: u64,
    request_started_at: Instant,
}

fn trace_epoch() -> Instant {
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    *EPOCH.get_or_init(Instant::now)
}

impl RequestTrace {
    fn start_if_enabled() -> Option<Arc<Self>> {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        stream_trace_enabled().then(|| {
            let _ = trace_epoch();
            Arc::new(Self {
                id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
                request_started_at: Instant::now(),
            })
        })
    }

    fn mark(&self, stage: &str) {
        eprintln!(
            "webui-stream-trace request={} t_epoch_ms={:.3} t_req_ms={:.3} stage={stage}",
            self.id,
            trace_epoch().elapsed().as_secs_f64() * 1_000.0,
            self.request_started_at.elapsed().as_secs_f64() * 1_000.0,
        );
    }

    fn mark_detail(&self, stage: &str, detail: std::fmt::Arguments<'_>) {
        eprintln!(
            "webui-stream-trace request={} t_epoch_ms={:.3} t_req_ms={:.3} stage={stage} {detail}",
            self.id,
            trace_epoch().elapsed().as_secs_f64() * 1_000.0,
            self.request_started_at.elapsed().as_secs_f64() * 1_000.0,
        );
    }
}

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
    flush_count: usize,
    trace: Option<Arc<RequestTrace>>,
}

impl ChannelWriter {
    #[cfg(test)]
    fn new(
        sender: mpsc::Sender<StreamChunk>,
        flush_threshold: Option<usize>,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self::with_trace(
            sender,
            flush_threshold,
            runtime,
            None,
            String::with_capacity(INITIAL_CAPACITY),
        )
    }

    /// Build a writer around an existing (ideally already-warmed) `String`
    /// allocation. The persistent render worker passes its reused scratch
    /// buffer here instead of a fresh allocation so a hot worker never pays
    /// another `String::with_capacity` per request; see [`Self::into_buffer`].
    fn with_trace(
        sender: mpsc::Sender<StreamChunk>,
        flush_threshold: Option<usize>,
        runtime: tokio::runtime::Handle,
        trace: Option<Arc<RequestTrace>>,
        buffer: String,
    ) -> Self {
        Self {
            buffer,
            flush_threshold,
            runtime,
            sender,
            flush_count: 0,
            trace,
        }
    }

    /// Reclaim the writer's buffer allocation so the caller can recycle its
    /// capacity for the next render job on this persistent worker thread. The
    /// buffer's length reflects whatever was left unflushed (empty on the
    /// normal `end()`-flushes-everything path); callers must `clear()` before
    /// reuse so a failed render's partial output can never leak into the next
    /// request's stream.
    fn into_buffer(mut self) -> String {
        mem::take(&mut self.buffer)
    }

    fn send(&mut self, chunk: StreamChunk) -> webui_handler::Result<()> {
        self.flush_count += 1;
        let flush_index = self.flush_count;
        let byte_len = chunk.as_ref().map(web::Bytes::len).unwrap_or(0);
        let try_send_started = self.trace.is_some().then(Instant::now);
        let chunk = match self.sender.try_send(chunk) {
            Ok(()) => {
                if let Some(trace) = &self.trace {
                    let try_send_us = try_send_started
                        .map(|started| started.elapsed().as_secs_f64() * 1_000_000.0)
                        .unwrap_or(0.0);
                    trace.mark_detail(
                        "flush",
                        format_args!(
                            "index={flush_index} bytes={byte_len} stalled=false try_send_us={try_send_us:.1}"
                        ),
                    );
                }
                return Ok(());
            }
            Err(TrySendError::Closed(_)) => {
                if let Some(trace) = &self.trace {
                    trace.mark_detail(
                        "disconnect",
                        format_args!("index={flush_index} where=send-closed"),
                    );
                }
                return Err(webui_handler::HandlerError::ClientDisconnected);
            }
            Err(TrySendError::Full(chunk)) => chunk,
        };
        if let Some(trace) = &self.trace {
            trace.mark_detail(
                "flush-stall-begin",
                format_args!("index={flush_index} bytes={byte_len}"),
            );
        }
        let stall_started = Instant::now();
        let result = self
            .runtime
            .block_on(self.sender.send_timeout(chunk, STREAM_FLUSH_TIMEOUT));
        if let Some(trace) = &self.trace {
            trace.mark_detail(
                "flush-stall-end",
                format_args!(
                    "index={flush_index} stall_ms={:.3} ok={}",
                    stall_started.elapsed().as_secs_f64() * 1_000.0,
                    result.is_ok()
                ),
            );
        }
        match result {
            Ok(()) => Ok(()),
            Err(SendTimeoutError::Closed(_)) => {
                Err(webui_handler::HandlerError::ClientDisconnected)
            }
            Err(SendTimeoutError::Timeout(_)) => Err(webui_handler::HandlerError::StreamTimeout),
        }
    }

    fn flush_if_needed(&mut self) -> webui_handler::Result<()> {
        if self
            .flush_threshold
            .is_some_and(|threshold| self.buffer.len() >= threshold)
        {
            self.flush()
        } else {
            Ok(())
        }
    }
}

impl ResponseWriter for ChannelWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        if self.sender.is_closed() {
            return Err(webui_handler::HandlerError::ClientDisconnected);
        }
        self.buffer.push_str(content);
        self.flush_if_needed()
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_attribute(&mut self, name: &str, value: &str) -> webui_handler::Result<()> {
        if self.sender.is_closed() {
            return Err(webui_handler::HandlerError::ClientDisconnected);
        }
        self.buffer.push(' ');
        self.buffer.push_str(name);
        self.buffer.push_str("=\"");
        self.buffer.push_str(value);
        self.buffer.push('"');
        self.flush_if_needed()
    }

    #[cfg(feature = "optimized-webui-writer")]
    fn write_boolean_attribute(&mut self, name: &str) -> webui_handler::Result<()> {
        if self.sender.is_closed() {
            return Err(webui_handler::HandlerError::ClientDisconnected);
        }
        self.buffer.push(' ');
        self.buffer.push_str(name);
        self.flush_if_needed()
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
        // Copy the committed segment into its own allocation instead of
        // `mem::take`-ing `self.buffer` (which would hand its allocation to
        // the channel and leave a zero-capacity `String` behind). A semantic
        // response emits several flushes, so taking the buffer forced every
        // following segment to regrow a `String` from empty one reallocation
        // at a time; measured over a representative response this cost ~60
        // extra heap allocations versus a single-flush render of the same
        // page. Clearing (not taking) keeps this buffer's capacity resident
        // for the rest of the response, and — because the persistent render
        // worker recycles it via `into_buffer` — for every later request the
        // worker serves, trading one bounded memcpy per flush for that
        // repeated allocator churn.
        //
        // Isolated benchmarking (4 configurations x 4 repeated passes against
        // the same local WebUI build) showed this copy-and-reuse strategy
        // regresses relative to baseline when paired with the system
        // allocator alone (median ~-3%, with individual passes as low as
        // -20%), but is never a net loss versus mimalloc-only once paired
        // with mimalloc — the only configuration this code actually ships in
        // (median +4.1%, no regressing pass). It is kept unconditionally on
        // that basis rather than as an independently toggleable feature.
        let bytes = {
            let bytes = web::Bytes::copy_from_slice(self.buffer.as_bytes());
            self.buffer.clear();
            bytes
        };
        self.send(Ok(bytes))
    }
}

struct ChannelStream {
    error: Arc<Mutex<Option<io::Error>>>,
    receiver: mpsc::Receiver<StreamChunk>,
    reported_error: bool,
    trace: Option<Arc<RequestTrace>>,
    first_polled: bool,
}

impl Stream for ChannelStream {
    type Item = StreamChunk;

    fn poll_next(
        mut self: Pin<&mut Self>,
        context: &mut TaskContext<'_>,
    ) -> Poll<Option<Self::Item>> {
        if !self.first_polled {
            self.first_polled = true;
            if let Some(trace) = &self.trace {
                trace.mark("first-poll");
            }
        }
        let polled = self.receiver.poll_recv(context);
        match polled {
            Poll::Ready(None) if !self.reported_error => {
                self.reported_error = true;
                let error = self.error.lock().ok().and_then(|mut error| error.take());
                if let Some(trace) = &self.trace {
                    if error.is_some() {
                        trace.mark("disconnect");
                    } else {
                        trace.mark("terminal-poll");
                    }
                }
                Poll::Ready(error.map(Err))
            }
            result => result,
        }
    }
}

struct RenderJob {
    error: Arc<Mutex<Option<io::Error>>>,
    input: RenderInput,
    request_path: String,
    sender: mpsc::Sender<StreamChunk>,
    trace: Option<Arc<RequestTrace>>,
}

enum RenderInput {
    Prepared(Value),
    WebUi {
        index: usize,
        request_timestamp: String,
    },
}

/// Publish a render job's error, if any, to its shared error mutex.
///
/// This MUST run — and complete — before the job's `ChannelWriter` (and the
/// `mpsc::Sender` it owns) is dropped via [`reclaim_render_buffer`].
/// Dropping the sender closes the response channel, and `ChannelStream`
/// treats a closed, drained channel as the terminal signal telling it to
/// consult this same mutex for a pending error (see
/// `ChannelStream::poll_next`). Locking and writing the mutex here — before
/// the sender is ever touched — establishes a happens-before edge (through
/// the mutex lock/unlock) from the error write to the later channel close,
/// so a `ChannelStream` polled concurrently on the async runtime can never
/// observe the channel closed while this mutex is still empty: as long as
/// the sender is alive the channel cannot be closed, and by the time it is
/// closed this write has already happened.
fn publish_render_error(error: &Mutex<Option<io::Error>>, result: Result<()>) {
    if let Err(render_error) = result {
        if let Ok(mut render_error_slot) = error.lock() {
            *render_error_slot = Some(io::Error::other(render_error));
        }
    }
}

/// Reclaim and clear a job's writer buffer so its allocation can be
/// recycled for the next job on this persistent worker thread.
///
/// `flush()` already clears the buffer on every successful boundary, but a
/// failed render may have left a partial, unflushed segment behind, and
/// that must never leak into the next request's stream — hence the
/// unconditional `clear()` here regardless of how the job ended. Consuming
/// `writer` drops its `mpsc::Sender`, closing the response channel; callers
/// MUST have already published any render error (see
/// [`publish_render_error`]) before calling this.
fn reclaim_render_buffer(writer: ChannelWriter) -> String {
    let mut buffer = writer.into_buffer();
    buffer.clear();
    buffer
}

/// Finish a render job for the persistent worker thread: publish any error
/// and then reclaim the writer's buffer, in that order — see
/// [`publish_render_error`] for why the order is mandatory.
fn finish_render_job(
    error: &Mutex<Option<io::Error>>,
    writer: ChannelWriter,
    result: Result<()>,
) -> String {
    publish_render_error(error, result);
    reclaim_render_buffer(writer)
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
        mut webui_states: Option<StatePool>,
    ) -> Result<Self> {
        let (sender, mut receiver) = mpsc::channel::<RenderJob>(STREAM_RENDER_QUEUE_CAPACITY);
        let runtime = tokio::runtime::Handle::current();
        let thread = thread::Builder::new()
            .name("webui-stream-render".to_owned())
            .spawn(move || {
                // This thread is the single, persistent render worker for every
                // request the process serves — jobs are handled one at a time,
                // never concurrently — so the writer's scratch buffer can be
                // recycled across requests instead of allocated fresh per job.
                // `render_scratch` always carries whatever capacity the buffer
                // grew to on a prior request; only the very first job (or one
                // whose peak segment exceeds the current capacity) pays a real
                // allocation.
                let mut render_scratch = String::with_capacity(INITIAL_CAPACITY);
                while let Some(job) = receiver.blocking_recv() {
                    if job.sender.is_closed() {
                        continue;
                    }
                    if let Some(trace) = &job.trace {
                        trace.mark("render-start");
                    }
                    // Reuse the render worker's persistent scratch buffer
                    // across jobs (see comment above `render_scratch`).
                    // Isolated benchmarking confirmed this reclamation is
                    // never a net loss once combined with mimalloc (its only
                    // shipped configuration) — see the comment in
                    // `ChannelWriter::flush` for the measured deltas — so it
                    // is kept unconditionally.
                    let scratch_buffer = mem::take(&mut render_scratch);
                    let mut writer = ChannelWriter::with_trace(
                        job.sender,
                        (!progressive_boundaries).then_some(STREAM_CHUNK_SIZE),
                        runtime.clone(),
                        job.trace.clone(),
                        scratch_buffer,
                    );
                    let options = RenderOptions::new(ENTRY_ID, &job.request_path);
                    let result = (|| -> Result<()> {
                        let render_state = match job.input {
                            RenderInput::Prepared(render_state) => render_state,
                            RenderInput::WebUi {
                                index,
                                request_timestamp,
                            } => {
                                let states = webui_states
                                    .as_mut()
                                    .context("WebUI render state pool is unavailable")?;
                                let render_state = states
                                    .variants
                                    .get_mut(index)
                                    .context("WebUI render state variant is unavailable")?;
                                rewrite_webui_request_state(render_state, &request_timestamp)?;
                                return drive_streaming_response(
                                    &handler,
                                    &protocol,
                                    render_state,
                                    &options,
                                    &mut writer,
                                )
                                .context("WebUI streaming render failed");
                            }
                        };
                        if progressive_boundaries {
                            drive_streaming_response(
                                &handler,
                                &protocol,
                                &render_state,
                                &options,
                                &mut writer,
                            )
                            .context("WebUI streaming render failed")
                        } else {
                            handler
                                .render(&protocol, &render_state, &options, &mut writer)
                                .context("WebUI render failed")
                        }
                    })();
                    if let Some(trace) = &job.trace {
                        trace.mark_detail("render-end", format_args!("ok={}", result.is_ok()));
                    }
                    // Publish any error before reclaiming the writer's
                    // buffer (which drops its sender and closes the
                    // channel) — see `finish_render_job` for why the order
                    // matters.
                    render_scratch = finish_render_job(&job.error, writer, result);
                }
            })
            .context("Failed to start WebUI streaming render worker")?;
        Ok(Self {
            sender: Some(sender),
            thread: Some(thread),
        })
    }

    fn stream(&self, render_state: Value, request_path: String) -> Result<ChannelStream> {
        self.stream_input(RenderInput::Prepared(render_state), request_path, None)
    }

    fn stream_webui(
        &self,
        index: usize,
        request_timestamp: String,
        request_path: String,
        trace: Option<Arc<RequestTrace>>,
    ) -> Result<ChannelStream> {
        self.stream_input(
            RenderInput::WebUi {
                index,
                request_timestamp,
            },
            request_path,
            trace,
        )
    }

    fn stream_input(
        &self,
        input: RenderInput,
        request_path: String,
        trace: Option<Arc<RequestTrace>>,
    ) -> Result<ChannelStream> {
        let (sender, receiver) = mpsc::channel(STREAM_RESPONSE_CHANNEL_CAPACITY);
        let error = Arc::new(Mutex::new(None));
        self.sender
            .as_ref()
            .context("WebUI streaming render worker is closed")?
            .try_send(RenderJob {
                error: Arc::clone(&error),
                input,
                request_path,
                sender,
                trace: trace.clone(),
            })
            .context("WebUI streaming render queue is full or closed")?;
        if let Some(trace) = &trace {
            trace.mark("queued");
        }
        Ok(ChannelStream {
            error,
            receiver,
            reported_error: false,
            trace,
            first_polled: false,
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

#[derive(Clone)]
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
    fast_routes: bool,
    handler: Arc<WebUIHandler>,
    metadata_body: web::Bytes,
    protocol: Arc<Protocol>,
    render_worker: Option<RenderWorker>,
    response_mode: ResponseMode,
    states: Mutex<StatePool>,
    next_variant: AtomicUsize,
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

fn materialize_webui_request_state(base: &Value, request_timestamp: &str) -> Result<Value> {
    let mut state = base.clone();
    rewrite_webui_request_state(&mut state, request_timestamp)?;
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

fn rewrite_webui_request_state(state: &mut Value, request_timestamp: &str) -> Result<()> {
    let variant_index = state
        .get("variantIndex")
        .and_then(Value::as_u64)
        .context("Prepared WebUI state is missing variantIndex")?;
    let root = state
        .as_object_mut()
        .context("Prepared WebUI request state must be an object")?;
    let timestamp = string_field_mut_or_insert(root, "requestTimestamp")?;
    timestamp.clear();
    timestamp.push_str(request_timestamp);
    let todos = root
        .get_mut("todos")
        .and_then(Value::as_array_mut)
        .context("Prepared WebUI request state must contain todos")?;
    for (index, todo) in todos.iter_mut().enumerate() {
        rewrite_webui_todo(todo, index, variant_index, request_timestamp)?;
    }
    let intelligence = root
        .get_mut("intelligence")
        .and_then(Value::as_object_mut)
        .context("Prepared WebUI request state must contain workspace intelligence")?;
    let preview_rows = intelligence
        .get_mut("previewRows")
        .and_then(Value::as_array_mut)
        .context("WebUI workspace intelligence must contain previewRows")?;
    for row in preview_rows {
        rewrite_workspace_row_title(row, request_timestamp)?;
    }
    let footer = root
        .get_mut("footer")
        .and_then(Value::as_object_mut)
        .context("Prepared WebUI request state must contain footer")?;
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

fn rewrite_webui_todo(
    todo: &mut Value,
    index: usize,
    variant_index: u64,
    request_timestamp: &str,
) -> Result<()> {
    let todo = todo
        .as_object_mut()
        .context("Every projected WebUI todo must be an object")?;
    let item_number = index + 1;
    let title = string_field_mut(todo, "title")?;
    title.clear();
    write!(title, "Todo {item_number:04} · ")?;
    title.push_str(request_timestamp);
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
    use_streaming_render: bool,
) -> Result<(Vec<usize>, usize)> {
    let mut lengths = Vec::with_capacity(states.len());
    let mut capacity = INITIAL_CAPACITY;
    for state in states {
        let request_state = if project_webui {
            materialize_webui_request_state(state, PROFILE_TIMESTAMP)?
        } else {
            materialize_request_state(state, PROFILE_TIMESTAMP)?
        };
        let output = if use_streaming_render {
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
    let mut states = parse_states(&state_bytes)?;
    let handler = Arc::new(create_handler(config.plugin));
    let project_webui = config.plugin == HydrationPlugin::WebUi;
    if project_webui {
        for state in &mut states.variants {
            *state = webui_render_state(state)?;
        }
    }
    // The complete suite always renders through WebUIHandler::render (never
    // render_streaming), so the one-time startup metadata (byte lengths and
    // the pre-rendered /cached body) must reflect that too, independent of
    // whichever streaming strategy the render worker uses for the (separate,
    // progressive-suite-only) Stream completion path below.
    let use_streaming_render = project_webui && config.response_mode == ResponseMode::Progressive;
    let (lengths, dynamic_capacity) = response_sizes(
        &handler,
        &protocol,
        &states.variants,
        project_webui,
        use_streaming_render,
    )?;
    let cached_timestamp = current_request_timestamp(&AtomicI64::new(0))?;
    let cached_state = if project_webui {
        materialize_webui_request_state(&states.variants[0], &cached_timestamp)?
    } else {
        materialize_request_state(&states.variants[0], &cached_timestamp)?
    };
    let cached_body = web::Bytes::from(if use_streaming_render {
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
    let metadata = build_metadata(
        lengths,
        cached_body.len(),
        config.plugin.app_id(),
        config.response_mode,
    );
    let metadata_body = web::Bytes::from(serde_json::to_vec(&metadata)?);
    let render_worker = if config.response_mode == ResponseMode::Progressive {
        Some(RenderWorker::new(
            Arc::clone(&handler),
            Arc::clone(&protocol),
            project_webui,
            project_webui.then(|| states.clone()),
        )?)
    } else {
        None
    };
    let variant_headers = (0..STATE_VARIANT_COUNT)
        .map(|index| HeaderValue::from_str(&index.to_string()))
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_boxed_slice();
    Ok((
        web::Data::new(AppState {
            browser_assets,
            cached_body,
            dynamic_capacity,
            fast_routes: config.plugin == HydrationPlugin::FastV3,
            handler,
            metadata_body,
            protocol,
            render_worker,
            response_mode: config.response_mode,
            states: Mutex::new(states),
            next_variant: AtomicUsize::new(0),
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
        trace: None,
        first_polled: false,
    }
}

fn stream_timing_header(milliseconds: f64) -> Result<HeaderValue> {
    let mut value = String::with_capacity(32);
    write!(&mut value, "webui-stream-setup;dur={milliseconds:.3}")
        .context("Failed to format stream timing")?;
    HeaderValue::from_str(&value).context("Failed to encode server timing header")
}

async fn dynamic(request: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    let trace = RequestTrace::start_if_enabled();
    if let Some(trace) = &trace {
        trace.mark("accept");
    }
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
    let request_path = request.path();
    let accepts_partial = request
        .headers()
        .get("accept")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.contains("application/json") || value.contains("application/x-ndjson")
        });
    if state.response_mode == ResponseMode::Progressive && !state.fast_routes && !accepts_partial {
        let index = state.next_variant.fetch_add(1, Ordering::Relaxed) % STATE_VARIANT_COUNT;
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
        let stream = match state
            .render_worker
            .as_ref()
            .context("Progressive render worker is unavailable")
            .and_then(|worker| {
                worker.stream_webui(
                    index,
                    request_timestamp,
                    request_path.to_owned(),
                    trace.clone(),
                )
            }) {
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
            Some(started) => {
                match stream_timing_header(started.elapsed().as_secs_f64() * 1_000.0) {
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
            None => None,
        };
        let response = dynamic_stream_response(
            stream,
            HTML_CONTENT_TYPE,
            state.variant_headers[index].clone(),
            request_timestamp_header,
            server_timing,
        );
        if let Some(trace) = &trace {
            trace.mark("response-returned");
        }
        return response;
    }
    let (render_state, request_path, variant) = {
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
        let (index, request_state) = if state.fast_routes {
            states.next_mut()
        } else {
            let index = state.next_variant.fetch_add(1, Ordering::Relaxed) % STATE_VARIANT_COUNT;
            (index, &mut states.variants[index])
        };
        let rewrite_result = if state.fast_routes {
            rewrite_request_state(request_state, &request_timestamp)
        } else {
            rewrite_webui_request_state(request_state, &request_timestamp)
        };
        if let Err(error) = rewrite_result {
            return HttpResponse::InternalServerError()
                .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                .json(ErrorBody {
                    code: "state-materialization-failed",
                    message: error.to_string(),
                });
        }
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
        let render_state = scoped_state.as_ref().unwrap_or(request_state);
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
            return match state.protocol.render_partial(
                &state_json,
                ENTRY_ID,
                request_path,
                inventory,
            ) {
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
        if state.response_mode == ResponseMode::Complete {
            let output = match render_html(
                &state.handler,
                &state.protocol,
                render_state,
                state.dynamic_capacity,
                request_path,
            ) {
                Ok(output) => output,
                Err(error) => {
                    return HttpResponse::InternalServerError()
                        .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
                        .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
                        .json(ErrorBody {
                            code: "render-failed",
                            message: error.to_string(),
                        });
                }
            };
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
            return html_response(
                web::Bytes::from(output),
                DYNAMIC_CACHE_CONTROL,
                "dynamic",
                state.variant_headers[index].clone(),
                request_timestamp_header,
            );
        }
        let render_state = scoped_state.unwrap_or_else(|| request_state.clone());
        let request_path = request_path.to_owned();
        let variant = state.variant_headers[index].clone();
        // Drop the state guard before handing progressive work to the render
        // worker so partial/route requests are never blocked by body delivery.
        (render_state, request_path, variant)
    };
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
    let stream = match state
        .render_worker
        .as_ref()
        .context("Progressive render worker is unavailable")
        .and_then(|worker| worker.stream(render_state, request_path))
    {
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
    if state.response_mode == ResponseMode::Complete {
        return dynamic(request, state).await;
    }
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
        Ok(mut states) if state.fast_routes => states.next_mut().0,
        Ok(_) => state.next_variant.fetch_add(1, Ordering::Relaxed) % STATE_VARIANT_COUNT,
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
    let (index, request_state) = if state.fast_routes {
        states.next_mut()
    } else {
        let index = state.next_variant.fetch_add(1, Ordering::Relaxed) % STATE_VARIANT_COUNT;
        (index, &mut states.variants[index])
    };
    let rewrite_result = if state.fast_routes {
        rewrite_request_state(request_state, &request_timestamp)
    } else {
        rewrite_webui_request_state(request_state, &request_timestamp)
    };
    if let Err(error) = rewrite_result {
        return HttpResponse::InternalServerError()
            .insert_header((CONTENT_TYPE, JSON_CONTENT_TYPE))
            .insert_header((CACHE_CONTROL, DYNAMIC_CACHE_CONTROL))
            .json(ErrorBody {
                code: "state-materialization-failed",
                message: error.to_string(),
            });
    }
    let work_state = request_state.clone();
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
        current_request_timestamp, finish_render_job, html_response, load_browser_route_assets,
        materialize_request_state, parse_states, rewrite_request_state,
        rewrite_webui_request_state, stream_timing_header, webui_render_state, ChannelStream,
        ChannelWriter, CACHED_CACHE_CONTROL, DYNAMIC_CACHE_CONTROL, HTML_CONTENT_TYPE,
        STATE_VARIANT_COUNT, WEBUI_TODO_FIELDS,
    };
    use actix_web::body::MessageBody;
    use actix_web::http::header::{HeaderValue, CACHE_CONTROL, CONTENT_TYPE};
    use actix_web::web;
    use anyhow::anyhow;
    use futures_core::Stream as _;
    use serde::Serialize;
    use serde_json::{json, Map, Value};
    use std::pin::Pin;
    use std::sync::atomic::AtomicI64;
    use std::sync::{Arc, Mutex};
    use std::task::{Context as TaskContext, Poll, Waker};
    use std::thread;
    use webui_handler::{FlushWriter, ResponseWriter};

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
    fn stream_flush_avoids_waiting_when_channel_has_capacity() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap_or_else(|error| panic!("runtime should build: {error}"));
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let mut writer = ChannelWriter::new(sender, None, runtime.handle().clone());
        writer
            .write("ready")
            .unwrap_or_else(|error| panic!("stream write should succeed: {error}"));
        writer
            .flush()
            .unwrap_or_else(|error| panic!("stream flush should succeed: {error}"));
        let chunk = runtime
            .block_on(receiver.recv())
            .unwrap_or_else(|| panic!("stream chunk should be available"))
            .unwrap_or_else(|error| panic!("stream chunk should succeed: {error}"));
        assert_eq!(chunk, web::Bytes::from_static(b"ready"));
    }

    #[test]
    fn stream_writer_detects_a_closed_client_on_its_first_write() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap_or_else(|error| panic!("runtime should build: {error}"));
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        drop(receiver);
        let mut writer = ChannelWriter::new(sender, None, runtime.handle().clone());
        assert!(matches!(
            writer.write("disconnected"),
            Err(webui_handler::HandlerError::ClientDisconnected)
        ));
    }

    #[test]
    fn stream_flush_clears_the_buffer_but_keeps_its_capacity() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap_or_else(|error| panic!("runtime should build: {error}"));
        let (sender, mut receiver) = tokio::sync::mpsc::channel(4);
        let mut writer = ChannelWriter::new(sender, None, runtime.handle().clone());
        let capacity_before_first_flush = writer.buffer.capacity();
        writer
            .write("first-chunk")
            .unwrap_or_else(|error| panic!("stream write should succeed: {error}"));
        writer
            .flush()
            .unwrap_or_else(|error| panic!("stream flush should succeed: {error}"));
        assert!(writer.buffer.is_empty());
        assert_eq!(
            writer.buffer.capacity(),
            capacity_before_first_flush,
            "flush must clear the buffer without discarding its allocation"
        );
        writer
            .write("second-chunk")
            .unwrap_or_else(|error| panic!("stream write should succeed: {error}"));
        writer
            .flush()
            .unwrap_or_else(|error| panic!("stream flush should succeed: {error}"));
        let first = runtime
            .block_on(receiver.recv())
            .unwrap_or_else(|| panic!("first stream chunk should be available"))
            .unwrap_or_else(|error| panic!("first stream chunk should succeed: {error}"));
        let second = runtime
            .block_on(receiver.recv())
            .unwrap_or_else(|| panic!("second stream chunk should be available"))
            .unwrap_or_else(|error| panic!("second stream chunk should succeed: {error}"));
        assert_eq!(first, web::Bytes::from_static(b"first-chunk"));
        assert_eq!(second, web::Bytes::from_static(b"second-chunk"));
    }

    #[test]
    fn render_error_publication_never_races_a_polling_channel_stream_to_a_clean_eof() {
        // Drives the real production path — `finish_render_job`, the exact
        // helper `RenderWorker` calls — from another thread, while this
        // thread holds the job's error mutex locked. `finish_render_job`
        // must lock that same mutex (inside `publish_render_error`) before
        // it can reach `reclaim_render_buffer`, which drops the writer's
        // `mpsc::Sender` and closes the response channel. So as long as we
        // hold the lock, the other thread is deterministically blocked
        // *before* it can close the channel — no sleeps or timing needed.
        //
        // This is exactly the invariant that makes the ordering mandatory:
        // if production ever reclaimed the buffer before publishing the
        // error, the sender would be dropped without ever needing this
        // mutex, and the channel could close — surfacing a clean
        // `Ready(None)` — while the mutex, and this test's lock on it, are
        // still held.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap_or_else(|error| panic!("runtime should build: {error}"));
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        let job_error: Arc<Mutex<Option<std::io::Error>>> = Arc::new(Mutex::new(None));
        let writer = ChannelWriter::new(sender, None, runtime.handle().clone());
        let mut stream = ChannelStream {
            error: Arc::clone(&job_error),
            receiver,
            reported_error: false,
            trace: None,
            first_polled: false,
        };
        let mut context = TaskContext::from_waker(Waker::noop());

        let guard = job_error
            .lock()
            .unwrap_or_else(|error| panic!("mutex should not be poisoned: {error}"));

        let job_error_for_worker = Arc::clone(&job_error);
        let worker = thread::spawn(move || {
            finish_render_job(&job_error_for_worker, writer, Err(anyhow!("render failed")))
        });

        // The worker cannot get past `publish_render_error`'s lock
        // acquisition while we hold `guard`, so it cannot have reached
        // `reclaim_render_buffer` yet: the sender is still alive and the
        // channel cannot be observed closed. Correct production ordering
        // guarantees `Pending` here; reversed ordering would let the worker
        // drop the sender without ever touching this mutex, exposing
        // `Ready(None)` instead.
        assert!(
            matches!(Pin::new(&mut stream).poll_next(&mut context), Poll::Pending),
            "the channel must still be open while the error mutex is held, proving the \
             worker has not yet reclaimed (and dropped) the writer's sender"
        );

        drop(guard);
        let recycled = worker
            .join()
            .unwrap_or_else(|error| std::panic::resume_unwind(error));
        assert!(
            recycled.is_empty(),
            "a failed job's scratch buffer must be cleared before reuse"
        );

        match Pin::new(&mut stream).poll_next(&mut context) {
            Poll::Ready(Some(Err(error))) => {
                assert!(error.to_string().contains("render failed"));
            }
            other => panic!("expected the failed render's error, got {other:?}"),
        }
    }

    #[test]
    fn render_worker_reclamation_never_leaks_a_failed_jobs_output_into_the_next_job() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap_or_else(|error| panic!("runtime should build: {error}"));

        // --- Job 1: writes a partial, unflushed segment and then fails. ---
        let (sender, _receiver) = tokio::sync::mpsc::channel(4);
        let job_error = Arc::new(Mutex::new(None));
        let mut writer = ChannelWriter::new(sender, None, runtime.handle().clone());
        writer
            .write("partial-output-from-a-failed-render")
            .unwrap_or_else(|error| panic!("stream write should succeed: {error}"));
        // Go through the exact same reclamation helper `RenderWorker` calls
        // in production, so this test exercises the real path rather than a
        // hand-rolled stand-in for it.
        let recycled = finish_render_job(&job_error, writer, Err(anyhow!("render failed")));
        assert!(
            recycled.is_empty(),
            "a failed job's scratch buffer must be cleared before reuse"
        );

        // --- Job 2: reuses job 1's reclaimed scratch and succeeds. -------
        let (next_sender, mut next_receiver) = tokio::sync::mpsc::channel(4);
        let mut next_writer =
            ChannelWriter::with_trace(next_sender, None, runtime.handle().clone(), None, recycled);
        next_writer
            .write("next-request")
            .unwrap_or_else(|error| panic!("stream write should succeed: {error}"));
        next_writer
            .flush()
            .unwrap_or_else(|error| panic!("stream flush should succeed: {error}"));
        let next_job_error = Arc::new(Mutex::new(None));
        let recycled_again = finish_render_job(&next_job_error, next_writer, Ok(()));
        assert!(recycled_again.is_empty());

        let chunk = runtime
            .block_on(next_receiver.recv())
            .unwrap_or_else(|| panic!("stream chunk should be available"))
            .unwrap_or_else(|error| panic!("stream chunk should succeed: {error}"));
        assert_eq!(
            chunk,
            web::Bytes::from_static(b"next-request"),
            "the recycled scratch buffer must contain only the second job's output, with \
             no bytes leaked from the failed first job"
        );
        assert!(
            runtime.block_on(next_receiver.recv()).is_none(),
            "the second job's stream must end after its single chunk"
        );
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
    fn projected_webui_state_updates_without_omitted_fields() {
        let state = json!({
            "variantIndex": 0,
            "todos": [{
                "description": "old",
                "title": "old"
            }],
            "intelligence": {
                "previewRows": [{
                    "id": "todo-0001",
                    "title": "old"
                }]
            },
            "footer": {}
        });
        let mut state = state;
        rewrite_webui_request_state(&mut state, "2026-08-28T00:00:00.000000Z")
            .unwrap_or_else(|error| panic!("projected state should update: {error}"));
        assert_eq!(
            state["todos"][0]["title"],
            "Todo 0001 · 2026-08-28T00:00:00.000000Z"
        );
        assert_eq!(
            state["intelligence"]["previewRows"][0]["title"],
            "Todo 0001 · 2026-08-28T00:00:00.000000Z"
        );
        assert_eq!(
            state["footer"]["requestTimestampLabel"],
            "Rendered 2026-08-28T00:00:00.000000Z"
        );
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
