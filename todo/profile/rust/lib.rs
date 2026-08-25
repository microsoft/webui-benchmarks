// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use webui_handler::plugin::HandlerPlugin;
use webui_handler::{Protocol, RenderOptions, ResponseWriter, WebUIHandler};
use webui_protocol::condition_expr;
use webui_protocol::web_ui_fragment::Fragment;
use webui_protocol::{
    ConditionExpr, FragmentList, WebUIFragment, WebUIFragmentAttribute, WebUIProtocol,
};

include!("fixture_paths.rs");

/// Number of immutable request states in the benchmark contract.
pub const STATE_VARIANT_COUNT: usize = 32;

/// Number of todo items in every state variant.
pub const TODO_ITEM_COUNT: usize = 100;

const ENTRY_ID: &str = "index.html";
const REQUEST_PATH: &str = "/";

/// Loaded real and derived protocols with the exact benchmark state pool.
pub struct ProfileFixture {
    /// Corrected generated componentized Light DOM protocol.
    pub light: Protocol,
    /// Light DOM protocol with component boundaries flattened at profile setup.
    pub flat: Protocol,
    /// Protocol generated from the same app source with Shadow DOM enabled.
    pub shadow: Protocol,
    /// The exact 32 immutable 100-item states used by the HTTP benchmark.
    pub states: Box<[Value]>,
    /// Output sizes for each Light DOM state.
    pub light_output_sizes: Box<[usize]>,
    /// Output sizes for each Shadow DOM state.
    pub shadow_output_sizes: Box<[usize]>,
}

impl ProfileFixture {
    /// Load and validate all profile inputs.
    pub fn load() -> Result<Self> {
        let light_document = load_document(LIGHT_PROTOCOL_PATH)?;
        if light_document
            .components
            .values()
            .any(|component| component.uses_shadow_dom)
        {
            bail!("generated todo protocol must use Light DOM");
        }
        let shadow_document = load_document(SHADOW_PROTOCOL_PATH)?;
        if !shadow_document
            .components
            .values()
            .any(|component| component.uses_shadow_dom)
        {
            bail!("profile shadow protocol must use Shadow DOM");
        }
        let states = load_states(STATE_POOL_PATH)?;
        let flat_document = flatten_components(&light_document)?;

        let light = Protocol::new(light_document);
        let flat = Protocol::new(flat_document);
        let shadow = Protocol::new(shadow_document);
        let handler = WebUIHandler::new();
        let mut light_output_sizes = Vec::with_capacity(states.len());
        let mut shadow_output_sizes = Vec::with_capacity(states.len());

        for (index, state) in states.iter().enumerate() {
            let light_output = render_to_string(&handler, &light, state, 256 * 1024)
                .with_context(|| format!("failed to render Light DOM state {index}"))?;
            let flat_output = render_to_string(&handler, &flat, state, light_output.len())
                .with_context(|| format!("failed to render flat state {index}"))?;
            if flat_output != light_output {
                bail!("flat protocol output differs from component output for state {index}");
            }
            let shadow_output = render_to_string(&handler, &shadow, state, 256 * 1024)
                .with_context(|| format!("failed to render Shadow DOM state {index}"))?;
            light_output_sizes.push(light_output.len());
            shadow_output_sizes.push(shadow_output.len());
        }

        Ok(Self {
            light,
            flat,
            shadow,
            states,
            light_output_sizes: light_output_sizes.into_boxed_slice(),
            shadow_output_sizes: shadow_output_sizes.into_boxed_slice(),
        })
    }

    /// Largest Light DOM response across the state pool.
    #[must_use]
    pub fn light_capacity(&self) -> usize {
        self.light_output_sizes
            .iter()
            .copied()
            .max()
            .unwrap_or_default()
    }

    /// Largest Shadow DOM response across the state pool.
    #[must_use]
    pub fn shadow_capacity(&self) -> usize {
        self.shadow_output_sizes
            .iter()
            .copied()
            .max()
            .unwrap_or_default()
    }
}

fn load_document(path: &str) -> Result<WebUIProtocol> {
    let bytes = fs::read(path).with_context(|| format!("failed to read {path}"))?;
    WebUIProtocol::from_protobuf(&bytes)
        .with_context(|| format!("failed to decode protocol {path}"))
}

fn load_states(path: &str) -> Result<Box<[Value]>> {
    let bytes = fs::read(path).with_context(|| format!("failed to read {path}"))?;
    let states: Vec<Value> =
        serde_json::from_slice(&bytes).with_context(|| format!("failed to decode {path}"))?;
    if states.len() != STATE_VARIANT_COUNT {
        bail!(
            "state pool must contain {STATE_VARIANT_COUNT} variants, received {}",
            states.len()
        );
    }
    for (index, state) in states.iter().enumerate() {
        if state.get("variantIndex").and_then(Value::as_u64) != Some(index as u64) {
            bail!("state {index} has an invalid variantIndex");
        }
        if state.get("todos").and_then(Value::as_array).map(Vec::len) != Some(TODO_ITEM_COUNT) {
            bail!("state {index} does not contain {TODO_ITEM_COUNT} todos");
        }
    }
    Ok(states.into_boxed_slice())
}

/// String-backed response writer used by the profile targets.
pub struct StringWriter {
    /// Rendered output.
    pub output: String,
}

impl StringWriter {
    /// Create a writer with an exact initial capacity.
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            output: String::with_capacity(capacity),
        }
    }

    /// Clear output without releasing its allocation.
    pub fn clear(&mut self) {
        self.output.clear();
    }
}

impl ResponseWriter for StringWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        self.output.push_str(content);
        Ok(())
    }

    webui_handler::string_response_writer_methods!(output);

    fn end(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

/// Render a protocol to an owned string.
pub fn render_to_string(
    handler: &WebUIHandler,
    protocol: &Protocol,
    state: &Value,
    capacity: usize,
) -> Result<String> {
    let mut writer = StringWriter::with_capacity(capacity);
    handler
        .render(
            protocol,
            state,
            &RenderOptions::new(ENTRY_ID, REQUEST_PATH),
            &mut writer,
        )
        .context("WebUI render failed")?;
    Ok(writer.output)
}

/// Writer that observes output without copying it.
#[derive(Default)]
pub struct CountWriter {
    bytes: usize,
    calls: usize,
    empty_calls: usize,
    small_calls: usize,
}

impl CountWriter {
    /// Reset all counters.
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    /// Snapshot the current counters.
    #[must_use]
    pub fn snapshot(&self) -> WriterStats {
        WriterStats {
            bytes: self.bytes,
            calls: self.calls,
            empty_calls: self.empty_calls,
            small_calls: self.small_calls,
        }
    }
}

impl ResponseWriter for CountWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        self.bytes += content.len();
        self.calls += 1;
        self.empty_calls += usize::from(content.is_empty());
        self.small_calls += usize::from(content.len() <= 8);
        Ok(())
    }

    fn write_attribute(&mut self, name: &str, value: &str) -> webui_handler::Result<()> {
        let length = name.len().saturating_add(value.len()).saturating_add(4);
        self.bytes += length;
        self.calls += 1;
        self.small_calls += usize::from(length <= 8);
        Ok(())
    }

    fn write_boolean_attribute(&mut self, name: &str) -> webui_handler::Result<()> {
        let length = name.len().saturating_add(1);
        self.bytes += length;
        self.calls += 1;
        self.small_calls += usize::from(length <= 8);
        Ok(())
    }

    fn end(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

/// Output call inventory from one render.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterStats {
    /// Total emitted bytes.
    pub bytes: usize,
    /// Calls to `ResponseWriter::write`.
    pub calls: usize,
    /// Calls carrying no bytes.
    pub empty_calls: usize,
    /// Calls carrying at most eight bytes.
    pub small_calls: usize,
}

/// Writer that records the exact chunks emitted by the handler.
#[derive(Default)]
pub struct RecordingWriter {
    /// Exact write chunks in call order.
    pub chunks: Vec<String>,
}

impl ResponseWriter for RecordingWriter {
    fn write(&mut self, content: &str) -> webui_handler::Result<()> {
        self.chunks.push(content.to_owned());
        Ok(())
    }

    fn write_attribute(&mut self, name: &str, value: &str) -> webui_handler::Result<()> {
        let mut attribute =
            String::with_capacity(name.len().saturating_add(value.len()).saturating_add(4));
        webui_handler::append_attribute_to_string(&mut attribute, name, value);
        self.chunks.push(attribute);
        Ok(())
    }

    fn write_boolean_attribute(&mut self, name: &str) -> webui_handler::Result<()> {
        let mut attribute = String::with_capacity(name.len().saturating_add(1));
        webui_handler::append_boolean_attribute_to_string(&mut attribute, name);
        self.chunks.push(attribute);
        Ok(())
    }

    fn end(&mut self) -> webui_handler::Result<()> {
        Ok(())
    }
}

/// Render once and return the exact write chunks.
pub fn record_chunks(protocol: &Protocol, state: &Value) -> Result<Vec<String>> {
    let mut writer = RecordingWriter::default();
    WebUIHandler::new()
        .render(
            protocol,
            state,
            &RenderOptions::new(ENTRY_ID, REQUEST_PATH),
            &mut writer,
        )
        .context("failed to record render chunks")?;
    Ok(writer.chunks)
}

/// Pre-coalesce recorded chunks into batches no larger than a target when practical.
#[must_use]
pub fn batch_chunks(chunks: &[String], target: usize) -> Vec<String> {
    let mut batches = Vec::with_capacity(chunks.len());
    let mut current = String::with_capacity(target);
    for chunk in chunks {
        if !current.is_empty() && current.len().saturating_add(chunk.len()) > target {
            batches.push(std::mem::take(&mut current));
            current = String::with_capacity(target);
        }
        current.push_str(chunk);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    batches
}

/// Replay pre-recorded chunks through the response-writer trait.
pub fn replay_chunks(
    chunks: &[String],
    writer: &mut dyn ResponseWriter,
) -> webui_handler::Result<()> {
    for chunk in chunks {
        writer.write(chunk)?;
    }
    writer.end()
}

/// Static fragment inventory for a decoded protocol.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolInventory {
    /// Component definitions in protocol metadata.
    pub component_metadata: usize,
    /// Total fragment records.
    pub fragment_records: usize,
    /// Counts by fragment variant.
    pub fragment_types: BTreeMap<&'static str, usize>,
    /// Number of condition-expression nodes.
    pub condition_nodes: usize,
    /// Total bytes held by raw fragments.
    pub raw_bytes: usize,
    /// Number of paths containing at least one dot.
    pub dotted_paths: usize,
    /// Maximum number of path segments.
    pub maximum_path_segments: usize,
}

/// Inventory a decoded protocol without modifying production code.
pub fn protocol_inventory(path: &str) -> Result<ProtocolInventory> {
    let document = load_document(path)?;
    let mut fragment_types = BTreeMap::new();
    let mut condition_nodes = 0;
    let mut raw_bytes = 0;
    let mut dotted_paths = 0;
    let mut maximum_path_segments = 0;
    for list in document.fragments.values() {
        for wrapper in &list.fragments {
            match wrapper.fragment.as_ref() {
                Some(Fragment::Raw(raw)) => {
                    increment(&mut fragment_types, "raw");
                    raw_bytes += raw.value.len();
                }
                Some(Fragment::Component(_)) => increment(&mut fragment_types, "component"),
                Some(Fragment::ForLoop(for_loop)) => {
                    increment(&mut fragment_types, "for");
                    record_path(
                        &for_loop.collection,
                        &mut dotted_paths,
                        &mut maximum_path_segments,
                    );
                }
                Some(Fragment::Signal(signal)) => {
                    increment(&mut fragment_types, "signal");
                    record_path(&signal.value, &mut dotted_paths, &mut maximum_path_segments);
                }
                Some(Fragment::IfCond(if_cond)) => {
                    increment(&mut fragment_types, "if");
                    if let Some(condition) = &if_cond.condition {
                        condition_nodes += count_condition_nodes(condition);
                        visit_condition_paths(
                            condition,
                            &mut dotted_paths,
                            &mut maximum_path_segments,
                        );
                    }
                }
                Some(Fragment::Attribute(attribute)) => {
                    increment(&mut fragment_types, "attribute");
                    if !attribute.raw_value && !attribute.value.is_empty() {
                        record_path(
                            &attribute.value,
                            &mut dotted_paths,
                            &mut maximum_path_segments,
                        );
                    }
                    if let Some(condition) = &attribute.condition_tree {
                        condition_nodes += count_condition_nodes(condition);
                        visit_condition_paths(
                            condition,
                            &mut dotted_paths,
                            &mut maximum_path_segments,
                        );
                    }
                }
                Some(Fragment::Plugin(_)) => increment(&mut fragment_types, "plugin"),
                Some(Fragment::Route(_)) => increment(&mut fragment_types, "route"),
                Some(Fragment::Outlet(_)) => increment(&mut fragment_types, "outlet"),
                Some(Fragment::Boundary(_)) => increment(&mut fragment_types, "boundary"),
                None => increment(&mut fragment_types, "empty"),
            }
        }
    }
    Ok(ProtocolInventory {
        component_metadata: document.components.len(),
        fragment_records: document.fragments.len(),
        fragment_types,
        condition_nodes,
        raw_bytes,
        dotted_paths,
        maximum_path_segments,
    })
}

fn increment(counts: &mut BTreeMap<&'static str, usize>, name: &'static str) {
    *counts.entry(name).or_default() += 1;
}

fn record_path(path: &str, dotted_paths: &mut usize, maximum_path_segments: &mut usize) {
    if path.is_empty() {
        return;
    }
    let segments = path.bytes().filter(|byte| *byte == b'.').count() + 1;
    *dotted_paths += usize::from(segments > 1);
    *maximum_path_segments = (*maximum_path_segments).max(segments);
}

fn count_condition_nodes(root: &ConditionExpr) -> usize {
    let mut count = 0;
    let mut stack = vec![root];
    while let Some(condition) = stack.pop() {
        count += 1;
        match condition.expr.as_ref() {
            Some(condition_expr::Expr::Not(not)) => {
                if let Some(inner) = not.condition.as_deref() {
                    stack.push(inner);
                }
            }
            Some(condition_expr::Expr::Compound(compound)) => {
                if let Some(left) = compound.left.as_deref() {
                    stack.push(left);
                }
                if let Some(right) = compound.right.as_deref() {
                    stack.push(right);
                }
            }
            _ => {}
        }
    }
    count
}

fn visit_condition_paths(
    root: &ConditionExpr,
    dotted_paths: &mut usize,
    maximum_path_segments: &mut usize,
) {
    let mut stack = vec![root];
    while let Some(condition) = stack.pop() {
        match condition.expr.as_ref() {
            Some(condition_expr::Expr::Identifier(identifier)) => {
                record_path(&identifier.value, dotted_paths, maximum_path_segments)
            }
            Some(condition_expr::Expr::Predicate(predicate)) => {
                record_path(&predicate.left, dotted_paths, maximum_path_segments);
                record_path(&predicate.right, dotted_paths, maximum_path_segments);
            }
            Some(condition_expr::Expr::Not(not)) => {
                if let Some(inner) = not.condition.as_deref() {
                    stack.push(inner);
                }
            }
            Some(condition_expr::Expr::Compound(compound)) => {
                if let Some(left) = compound.left.as_deref() {
                    stack.push(left);
                }
                if let Some(right) = compound.right.as_deref() {
                    stack.push(right);
                }
            }
            None => {}
        }
    }
}

type PathMap = HashMap<String, String>;

struct FlatJob {
    source_id: String,
    target_id: String,
    paths: PathMap,
}

struct InlineFrame {
    fragments: Vec<WebUIFragment>,
    index: usize,
    paths: PathMap,
    collecting: bool,
    component_paths: PathMap,
    unsupported_attribute: Option<String>,
}

struct FlatBuilder {
    source: HashMap<String, FragmentList>,
    output: HashMap<String, FragmentList>,
    jobs: VecDeque<FlatJob>,
    next_id: usize,
}

impl FlatBuilder {
    fn new(source: &HashMap<String, FragmentList>) -> Self {
        Self {
            source: source.clone(),
            output: HashMap::with_capacity(source.len()),
            jobs: VecDeque::new(),
            next_id: 0,
        }
    }

    fn build(mut self) -> Result<HashMap<String, FragmentList>> {
        self.jobs.push_back(FlatJob {
            source_id: ENTRY_ID.to_owned(),
            target_id: ENTRY_ID.to_owned(),
            paths: HashMap::new(),
        });
        while let Some(job) = self.jobs.pop_front() {
            let fragments = self.expand(&job.source_id, job.paths)?;
            self.output.insert(
                job.target_id,
                FragmentList {
                    fragments,
                    contains_boundary: false,
                },
            );
        }
        Ok(self.output)
    }

    fn expand(&mut self, source_id: &str, paths: PathMap) -> Result<Vec<WebUIFragment>> {
        let source = self
            .source
            .get(source_id)
            .with_context(|| format!("flat transform is missing fragment {source_id}"))?
            .fragments
            .clone();
        let mut frames = vec![InlineFrame {
            fragments: source,
            index: 0,
            paths,
            collecting: false,
            component_paths: HashMap::new(),
            unsupported_attribute: None,
        }];
        let mut result = Vec::new();

        while !frames.is_empty() {
            let frame_index = frames.len() - 1;
            if frames[frame_index].index == frames[frame_index].fragments.len() {
                frames.pop();
                continue;
            }
            let mut wrapper = frames[frame_index].fragments[frames[frame_index].index].clone();
            frames[frame_index].index += 1;
            let Some(fragment) = wrapper.fragment.take() else {
                result.push(wrapper);
                continue;
            };
            match fragment {
                Fragment::Raw(raw) => {
                    wrapper.fragment = Some(Fragment::Raw(raw));
                    result.push(wrapper);
                }
                Fragment::Signal(mut signal) => {
                    signal.value = rewrite_path(&signal.value, &frames[frame_index].paths);
                    wrapper.fragment = Some(Fragment::Signal(signal));
                    result.push(wrapper);
                }
                Fragment::Attribute(mut attribute) => {
                    self.transform_attribute(&mut attribute, &mut frames[frame_index])?;
                    if !attribute.complex {
                        wrapper.fragment = Some(Fragment::Attribute(attribute));
                        result.push(wrapper);
                    }
                }
                Fragment::Component(component) => {
                    if let Some(reason) = frames[frame_index].unsupported_attribute.take() {
                        bail!(
                            "cannot flatten component {} because {reason}",
                            component.fragment_id
                        );
                    }
                    let child_paths = std::mem::take(&mut frames[frame_index].component_paths);
                    frames[frame_index].collecting = false;
                    let child = self
                        .source
                        .get(&component.fragment_id)
                        .with_context(|| {
                            format!("component {} has no fragment body", component.fragment_id)
                        })?
                        .fragments
                        .clone();
                    frames.push(InlineFrame {
                        fragments: child,
                        index: 0,
                        paths: child_paths,
                        collecting: false,
                        component_paths: HashMap::new(),
                        unsupported_attribute: None,
                    });
                }
                Fragment::ForLoop(mut for_loop) => {
                    for_loop.collection =
                        rewrite_path(&for_loop.collection, &frames[frame_index].paths);
                    let mut child_paths = frames[frame_index].paths.clone();
                    child_paths.remove(&for_loop.item);
                    let target_id = self.next_fragment_id();
                    self.jobs.push_back(FlatJob {
                        source_id: for_loop.fragment_id,
                        target_id: target_id.clone(),
                        paths: child_paths,
                    });
                    for_loop.fragment_id = target_id;
                    wrapper.fragment = Some(Fragment::ForLoop(for_loop));
                    result.push(wrapper);
                }
                Fragment::IfCond(mut if_cond) => {
                    if let Some(condition) = &mut if_cond.condition {
                        rewrite_condition(condition, &frames[frame_index].paths);
                    }
                    let target_id = self.next_fragment_id();
                    self.jobs.push_back(FlatJob {
                        source_id: if_cond.fragment_id,
                        target_id: target_id.clone(),
                        paths: frames[frame_index].paths.clone(),
                    });
                    if_cond.fragment_id = target_id;
                    wrapper.fragment = Some(Fragment::IfCond(if_cond));
                    result.push(wrapper);
                }
                Fragment::Route(_) | Fragment::Outlet(_) => {
                    bail!("the todo flat transform does not support route fragments")
                }
                Fragment::Boundary(_) => {
                    bail!("the todo flat transform does not support boundary fragments")
                }
                Fragment::Plugin(plugin) => {
                    wrapper.fragment = Some(Fragment::Plugin(plugin));
                    result.push(wrapper);
                }
            }
        }
        Ok(result)
    }

    fn transform_attribute(
        &mut self,
        attribute: &mut WebUIFragmentAttribute,
        frame: &mut InlineFrame,
    ) -> Result<()> {
        if attribute.attr_start {
            frame.collecting = true;
            frame.component_paths.clear();
            frame.unsupported_attribute = None;
        }
        if !attribute.raw_value && !attribute.value.is_empty() {
            attribute.value = rewrite_path(&attribute.value, &frame.paths);
        }
        if let Some(condition) = &mut attribute.condition_tree {
            rewrite_condition(condition, &frame.paths);
        }
        if !attribute.template.is_empty() {
            let target_id = self.next_fragment_id();
            self.jobs.push_back(FlatJob {
                source_id: std::mem::take(&mut attribute.template),
                target_id: target_id.clone(),
                paths: frame.paths.clone(),
            });
            attribute.template = target_id;
        }
        if !frame.collecting || attribute.attr_skip {
            return Ok(());
        }

        let name = webui_protocol::attrs::attribute_to_camel(
            attribute.name.strip_prefix(':').unwrap_or(&attribute.name),
        );
        if attribute.condition_tree.is_some() {
            frame.unsupported_attribute = Some(format!(
                "boolean attribute {} is not a state path",
                attribute.name
            ));
        } else if !attribute.template.is_empty() {
            frame.unsupported_attribute = Some(format!(
                "template attribute {} is not a state path",
                attribute.name
            ));
        } else if attribute.raw_value {
            frame.unsupported_attribute = Some(format!(
                "raw attribute {} is not a state path",
                attribute.name
            ));
        } else if !attribute.value.is_empty() {
            frame.component_paths.insert(name, attribute.value.clone());
        }
        Ok(())
    }

    fn next_fragment_id(&mut self) -> String {
        let id = format!("profile-flat-{}", self.next_id);
        self.next_id += 1;
        id
    }
}

fn rewrite_path(path: &str, paths: &PathMap) -> String {
    let first = path.split('.').next().unwrap_or(path);
    let Some(prefix) = paths.get(first) else {
        return path.to_owned();
    };
    if first.len() == path.len() {
        return prefix.clone();
    }
    let mut output = String::with_capacity(prefix.len() + path.len() - first.len());
    output.push_str(prefix);
    output.push_str(&path[first.len()..]);
    output
}

fn rewrite_condition(condition: &mut ConditionExpr, paths: &PathMap) {
    let mut stack = vec![condition];
    while let Some(current) = stack.pop() {
        match current.expr.as_mut() {
            Some(condition_expr::Expr::Identifier(identifier)) => {
                identifier.value = rewrite_path(&identifier.value, paths);
            }
            Some(condition_expr::Expr::Predicate(predicate)) => {
                predicate.left = rewrite_path(&predicate.left, paths);
                predicate.right = rewrite_path(&predicate.right, paths);
            }
            Some(condition_expr::Expr::Not(not)) => {
                if let Some(inner) = not.condition.as_deref_mut() {
                    stack.push(inner);
                }
            }
            Some(condition_expr::Expr::Compound(compound)) => {
                if let Some(left) = compound.left.as_deref_mut() {
                    stack.push(left);
                }
                if let Some(right) = compound.right.as_deref_mut() {
                    stack.push(right);
                }
            }
            None => {}
        }
    }
}

fn flatten_components(source: &WebUIProtocol) -> Result<WebUIProtocol> {
    let mut flattened = source.clone();
    flattened.fragments = FlatBuilder::new(&source.fragments).build()?;
    Ok(flattened)
}

#[derive(Clone, Copy)]
enum PendingScope {
    None,
    Condition,
    Repeat,
}

struct CounterPlugin {
    pending_scope: PendingScope,
}

static SIGNALS: AtomicUsize = AtomicUsize::new(0);
static CONDITIONS: AtomicUsize = AtomicUsize::new(0);
static TRUE_CONDITIONS: AtomicUsize = AtomicUsize::new(0);
static LOOPS: AtomicUsize = AtomicUsize::new(0);
static LOOP_ITEMS: AtomicUsize = AtomicUsize::new(0);
static COMPONENT_SCOPES: AtomicUsize = AtomicUsize::new(0);
static SCOPE_PUSHES: AtomicUsize = AtomicUsize::new(0);
static PLUGIN_FRAGMENTS: AtomicUsize = AtomicUsize::new(0);

impl CounterPlugin {
    fn new() -> Self {
        Self {
            pending_scope: PendingScope::None,
        }
    }
}

impl HandlerPlugin for CounterPlugin {
    fn push_scope(&mut self) {
        SCOPE_PUSHES.fetch_add(1, Ordering::Relaxed);
        match self.pending_scope {
            PendingScope::Condition => {
                TRUE_CONDITIONS.fetch_add(1, Ordering::Relaxed);
            }
            PendingScope::Repeat => {}
            PendingScope::None => {
                COMPONENT_SCOPES.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.pending_scope = PendingScope::None;
    }

    fn pop_scope(&mut self) {}

    fn on_binding_start(
        &mut self,
        _name: &str,
        _raw: bool,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        SIGNALS.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    fn on_binding_end(
        &mut self,
        _name: &str,
        _raw: bool,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        Ok(())
    }

    fn on_for_start(
        &mut self,
        _name: &str,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        LOOPS.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    fn on_for_end(
        &mut self,
        _name: &str,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        Ok(())
    }

    fn on_if_start(
        &mut self,
        _name: &str,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        CONDITIONS.fetch_add(1, Ordering::Relaxed);
        self.pending_scope = PendingScope::Condition;
        Ok(())
    }

    fn on_if_end(
        &mut self,
        _name: &str,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        self.pending_scope = PendingScope::None;
        Ok(())
    }

    fn on_repeat_item_start(
        &mut self,
        _index: usize,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        LOOP_ITEMS.fetch_add(1, Ordering::Relaxed);
        self.pending_scope = PendingScope::Repeat;
        Ok(())
    }

    fn on_repeat_item_end(
        &mut self,
        _index: usize,
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        Ok(())
    }

    fn on_element_data(
        &mut self,
        _data: &[u8],
        _writer: &mut dyn ResponseWriter,
    ) -> webui_handler::Result<()> {
        PLUGIN_FRAGMENTS.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

fn counter_plugin_factory() -> Box<dyn HandlerPlugin> {
    Box::new(CounterPlugin::new())
}

/// Dynamic operation counts observed through profile-only plugin callbacks.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationCounts {
    /// Signal bindings rendered.
    pub signals: usize,
    /// Conditions evaluated.
    pub conditions: usize,
    /// Conditions whose body rendered.
    pub true_conditions: usize,
    /// For-loop blocks entered.
    pub loops: usize,
    /// Total loop iterations.
    pub loop_items: usize,
    /// Component scope entries.
    pub component_scopes: usize,
    /// All component, true-condition, and repeat scope pushes.
    pub scope_pushes: usize,
    /// Opaque plugin fragments encountered.
    pub plugin_fragments: usize,
}

/// Count dynamic operations without modifying the handler.
pub fn operation_counts(protocol: &Protocol, state: &Value) -> Result<OperationCounts> {
    for counter in [
        &SIGNALS,
        &CONDITIONS,
        &TRUE_CONDITIONS,
        &LOOPS,
        &LOOP_ITEMS,
        &COMPONENT_SCOPES,
        &SCOPE_PUSHES,
        &PLUGIN_FRAGMENTS,
    ] {
        counter.store(0, Ordering::Relaxed);
    }
    let handler = WebUIHandler::with_plugin(counter_plugin_factory);
    let mut writer = CountWriter::default();
    handler
        .render(
            protocol,
            state,
            &RenderOptions::new(ENTRY_ID, REQUEST_PATH),
            &mut writer,
        )
        .context("instrumented render failed")?;
    Ok(OperationCounts {
        signals: SIGNALS.load(Ordering::Relaxed),
        conditions: CONDITIONS.load(Ordering::Relaxed),
        true_conditions: TRUE_CONDITIONS.load(Ordering::Relaxed),
        loops: LOOPS.load(Ordering::Relaxed),
        loop_items: LOOP_ITEMS.load(Ordering::Relaxed),
        component_scopes: COMPONENT_SCOPES.load(Ordering::Relaxed),
        scope_pushes: SCOPE_PUSHES.load(Ordering::Relaxed),
        plugin_fragments: PLUGIN_FRAGMENTS.load(Ordering::Relaxed),
    })
}

/// Focused synthetic protocol kinds used to isolate handler costs.
#[derive(Clone, Copy, Debug)]
pub enum SyntheticKind {
    /// A loop rendering one global signal per item.
    FlatGlobal,
    /// The same output with a no-attribute component dispatch per item.
    ComponentGlobal,
    /// A loop rendering one item-local signal.
    FlatOneAttribute,
    /// The same output after one component attribute crosses the scope boundary.
    ComponentOneAttribute,
    /// A loop rendering four item-local signals.
    FlatFourAttributes,
    /// The same output after four component attributes cross the scope boundary.
    ComponentFourAttributes,
    /// A loop rendering a raw byte without a condition.
    FlatCondition,
    /// The same output through a true identifier condition and fragment dispatch.
    IdentifierCondition,
}

/// Build a focused 100-item synthetic protocol and state.
#[must_use]
pub fn synthetic_fixture(kind: SyntheticKind) -> (Protocol, Value) {
    let mut fragments = HashMap::new();
    fragments.insert(
        ENTRY_ID.to_owned(),
        FragmentList {
            fragments: vec![WebUIFragment::for_loop("item", "items", "loop-body")],
            contains_boundary: false,
        },
    );

    let loop_body = match kind {
        SyntheticKind::FlatGlobal => vec![WebUIFragment::signal("constant", false)],
        SyntheticKind::ComponentGlobal => {
            fragments.insert(
                "profile-child".to_owned(),
                FragmentList {
                    fragments: vec![WebUIFragment::signal("constant", false)],
                    contains_boundary: false,
                },
            );
            vec![WebUIFragment::component("profile-child")]
        }
        SyntheticKind::FlatOneAttribute => {
            vec![WebUIFragment::signal("item.value", false)]
        }
        SyntheticKind::ComponentOneAttribute => {
            fragments.insert(
                "profile-child".to_owned(),
                FragmentList {
                    fragments: vec![WebUIFragment::signal("model.value", false)],
                    contains_boundary: false,
                },
            );
            vec![
                complex_attribute(":model", "item", true),
                WebUIFragment::component("profile-child"),
            ]
        }
        SyntheticKind::FlatFourAttributes => ["a", "b", "c", "d"]
            .into_iter()
            .map(|name| WebUIFragment::signal(format!("item.{name}"), false))
            .collect(),
        SyntheticKind::ComponentFourAttributes => {
            fragments.insert(
                "profile-child".to_owned(),
                FragmentList {
                    fragments: ["a", "b", "c", "d"]
                        .into_iter()
                        .map(|name| WebUIFragment::signal(name, false))
                        .collect(),
                    contains_boundary: false,
                },
            );
            let mut body = ["a", "b", "c", "d"]
                .into_iter()
                .enumerate()
                .map(|(index, name)| {
                    complex_attribute(format!(":{name}"), format!("item.{name}"), index == 0)
                })
                .collect::<Vec<_>>();
            body.push(WebUIFragment::component("profile-child"));
            body
        }
        SyntheticKind::FlatCondition => vec![WebUIFragment::raw("x")],
        SyntheticKind::IdentifierCondition => {
            fragments.insert(
                "profile-if".to_owned(),
                FragmentList {
                    fragments: vec![WebUIFragment::raw("x")],
                    contains_boundary: false,
                },
            );
            vec![WebUIFragment::if_cond(
                ConditionExpr::identifier("item.enabled"),
                "profile-if",
            )]
        }
    };
    fragments.insert(
        "loop-body".to_owned(),
        FragmentList {
            fragments: loop_body,
            contains_boundary: false,
        },
    );
    let items = (0..TODO_ITEM_COUNT)
        .map(|_| {
            let mut item = Map::new();
            for (name, value) in [
                ("a", "a"),
                ("b", "b"),
                ("c", "c"),
                ("d", "d"),
                ("value", "x"),
            ] {
                item.insert(name.to_owned(), Value::String(value.to_owned()));
            }
            item.insert("enabled".to_owned(), Value::Bool(true));
            Value::Object(item)
        })
        .collect::<Vec<_>>();
    let mut state = Map::new();
    state.insert("constant".to_owned(), Value::String("x".to_owned()));
    state.insert("items".to_owned(), Value::Array(items));
    (
        Protocol::new(WebUIProtocol::new(fragments)),
        Value::Object(state),
    )
}

fn complex_attribute(
    name: impl Into<String>,
    value: impl Into<String>,
    attr_start: bool,
) -> WebUIFragment {
    WebUIFragment {
        fragment: Some(Fragment::Attribute(WebUIFragmentAttribute {
            name: name.into(),
            value: value.into(),
            complex: true,
            attr_start,
            ..Default::default()
        })),
    }
}

/// Resolve a path that was split once at protocol-load time.
#[must_use]
pub fn resolve_compiled_path<'a>(parts: &[&str], state: &'a Value) -> Option<&'a Value> {
    let mut current = state;
    for part in parts {
        current = current.as_object()?.get(*part)?;
    }
    Some(current)
}

/// Count occurrences of entities generated by dynamic HTML escaping.
#[must_use]
pub fn escaped_entity_count(output: &str) -> usize {
    ["&amp;", "&lt;", "&gt;", "&quot;", "&#x27;", "&#x2F;"]
        .into_iter()
        .map(|entity| output.matches(entity).count())
        .sum()
}

/// Return a borrowed-or-owned string from a JSON value for direct microbenchmarks.
#[must_use]
pub fn value_text(value: &Value) -> Cow<'_, str> {
    match value {
        Value::String(text) => Cow::Borrowed(text),
        other => Cow::Owned(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        escaped_entity_count, operation_counts, protocol_inventory, render_to_string,
        synthetic_fixture, ProfileFixture, SyntheticKind, WebUIHandler, LIGHT_PROTOCOL_PATH,
        STATE_VARIANT_COUNT, TODO_ITEM_COUNT,
    };

    #[test]
    fn fixture_uses_exact_state_pool_and_equivalent_flat_output() {
        let fixture = ProfileFixture::load().unwrap_or_else(|error| {
            panic!("profile fixture should load: {error:#}");
        });
        assert_eq!(fixture.states.len(), STATE_VARIANT_COUNT);
        assert!(fixture.states.iter().all(|state| {
            state
                .get("todos")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|todos| todos.len() == TODO_ITEM_COUNT)
        }));
    }

    #[test]
    fn flattened_protocol_removes_component_dispatch() {
        let inventory = protocol_inventory(LIGHT_PROTOCOL_PATH).unwrap_or_else(|error| {
            panic!("protocol should inventory: {error:#}");
        });
        assert!(
            inventory
                .fragment_types
                .get("component")
                .copied()
                .unwrap_or_default()
                > 0
        );
        let fixture = ProfileFixture::load().unwrap_or_else(|error| {
            panic!("profile fixture should load: {error:#}");
        });
        let component = render_to_string(
            &WebUIHandler::new(),
            &fixture.light,
            &fixture.states[0],
            fixture.light_capacity(),
        )
        .unwrap_or_else(|error| panic!("component render should succeed: {error:#}"));
        let flat = render_to_string(
            &WebUIHandler::new(),
            &fixture.flat,
            &fixture.states[0],
            fixture.light_capacity(),
        )
        .unwrap_or_else(|error| panic!("flat render should succeed: {error:#}"));
        assert_eq!(component, flat);
    }

    #[test]
    fn operation_counter_is_non_rendering_instrumentation() {
        let fixture = ProfileFixture::load().unwrap_or_else(|error| {
            panic!("profile fixture should load: {error:#}");
        });
        let counts = operation_counts(&fixture.light, &fixture.states[0])
            .unwrap_or_else(|error| panic!("counter render should succeed: {error:#}"));
        assert!(counts.signals > TODO_ITEM_COUNT);
        assert!(counts.component_scopes > TODO_ITEM_COUNT);
        assert!(counts.conditions >= TODO_ITEM_COUNT);
    }

    #[test]
    fn focused_protocol_pairs_emit_equal_bytes() {
        for (flat_kind, component_kind) in [
            (SyntheticKind::FlatGlobal, SyntheticKind::ComponentGlobal),
            (
                SyntheticKind::FlatOneAttribute,
                SyntheticKind::ComponentOneAttribute,
            ),
            (
                SyntheticKind::FlatFourAttributes,
                SyntheticKind::ComponentFourAttributes,
            ),
            (
                SyntheticKind::FlatCondition,
                SyntheticKind::IdentifierCondition,
            ),
        ] {
            let (flat, state) = synthetic_fixture(flat_kind);
            let (component, _) = synthetic_fixture(component_kind);
            let flat_output = render_to_string(&WebUIHandler::new(), &flat, &state, 1024)
                .unwrap_or_else(|error| panic!("flat synthetic render failed: {error:#}"));
            let component_output = render_to_string(&WebUIHandler::new(), &component, &state, 1024)
                .unwrap_or_else(|error| panic!("component synthetic render failed: {error:#}"));
            assert_eq!(flat_output, component_output);
        }
    }

    #[test]
    fn entity_counter_observes_all_supported_entities() {
        assert_eq!(escaped_entity_count("&amp;&lt;&gt;&quot;&#x27;&#x2F;"), 6);
    }
}
